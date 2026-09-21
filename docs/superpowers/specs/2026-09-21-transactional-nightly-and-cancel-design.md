# Transactional nightly scoring + transactional `cancelLeave` — design

**Status:** proposal, awaiting owner approval. **No code is changed by this document.**
**Date:** 2026-09-21
**Touches:** `firebase/functions/index.js` (`computeDailyAttendanceStatus`), `admin/src/lib/firestore.ts` (`cancelLeave`), a new pure module `firebase/functions/nightlyScoring.js`.
**Needs no `firestore.rules` change** (verified — see §2.4). The 110-test `firebase/rules-tests` suite stays the regression gate anyway.

---

## 0. TL;DR

Four races were reported. Verified against the code:

| # | Claim | Verdict |
|---|---|---|
| (a) | `cancelLeave` reads before its batch → a cancel racing `scoreRetroactiveLeave` leaves a cancelled day paid and burns a PL day | **Real.** Confirmed at `admin/src/lib/firestore.ts:413-470`. |
| (b) | Nightly reads `plBalance` up front and decrements non-transactionally → two paid days against one balance day | **Real**, and the window is *the whole nightly run*, not just 23:59–00:00. `index.js:343`→`index.js:563`. |
| (c) | A scheduler **retry** for the same date re-runs past IST midnight and its un-merged `batch.set` clobbers a trigger-written SCHL | **Wrong as stated.** A retry recomputes `today` from the wall clock (`index.js:340-341`) and `minBackoffSeconds: 60`, so a retry after a 23:59 failure scores **D+1**, never D. The clobber is real but needs a *concurrent duplicate* of the same invocation, not a retry. **The retry behaviour hides a worse, more likely bug — see §1.3b.** |
| (d) | Leave approved between 00:00 IST and the nightly's batch commit is lost (trigger finds no doc, nightly writes Absent) | **Real**, plus a **fifth, closely related** race the brief did not list — a leave approved for *today* during the run is lost the same way (§1.5). |

**Recommendation: Option B (hybrid).** Keep the existing single bulk `batch` for every user whose day is decided by punches, and run **one Firestore transaction per user whose day is `Absent` or `SCHL`** — the only users who can touch `plBalance` and the only ones a late leave approval can change. Each such transaction re-reads the user doc, the day's status doc *and that user's approved leave requests* inside the transaction, then writes the status doc and the `plBalance` decrement atomically. Separately, convert `cancelLeave` to a client-SDK `runTransaction`.

That single restructuring closes **(b), (c), (d) and the fifth race**, and `cancelLeave`'s transaction closes **(a)**. No rules change, no schema change, no new collection, no reconciliation job.

---

## 1. Root-cause analysis

### 1.0 The four writers of `users/{uid}/attendance_status/{date}` (and of `plBalance`)

| Writer | SDK | Status write | `plBalance` write | Atomic? |
|---|---|---|---|---|
| `computeDailyAttendanceStatus` (`index.js:329-594`) | Admin | `batch.set`, **no merge**, ALL users in one batch (`index.js:515-520`) | `increment(-1)` per user, **after** the batch commits (`index.js:561-568`) | **No** — status and balance are two separate commits |
| `scoreRetroactiveLeave` (`index.js:625-702`) | Admin | `tx.set(..., {merge: true})` | `tx.update(increment(-paidDays))` | **Yes**, one transaction (`index.js:663-687`) |
| `cancelLeave` (`firestore.ts:386-472`) | Client | `batch.set(..., {merge:true})` → `Absent` | `increment(+refundedDays)` in the same batch (`firestore.ts:458`) | Batch is atomic, but **reads happen outside it** (`firestore.ts:414-419`) |
| `approveRegularization` / Mark WO | Client | `markedBy:'admin'` | — | n/a |
| `accrueMonthlyLeave` (`index.js:278-326`) | Admin | — | `increment(+1)`, guarded by a `create()` on `system/accruals/monthly/{month}` | Yes |

Everything below follows from row 1: **the nightly is the only writer that is not atomic in the pair (status, balance), and the only one that writes a full `set` from data it read seconds earlier.**

### 1.1 (a) `cancelLeave` vs `scoreRetroactiveLeave` — REAL

Interleaving, for a past date `D` granted by leave `L`:

```
t0  admin approves L (covers D, already past)      → trigger fires
t1  trigger txn: getAll(user, L, status/D)         → status/D = {Absent, auto}
t2  cancelLeave: getDoc(L)                          → approved, D still granted
t3  cancelLeave: getDoc(status/D)                   → {Absent, auto}   ← firestore.ts:415
t4  trigger txn COMMITS: status/D = {SCHL, salaryCredit:1}, plBalance -= 1
t5  cancelLeave batch COMMITS: cancelledDates += [D]
```

At `t3` the doc is `Absent`, so `scoredAsLeave` is false (`firestore.ts:442`) and `D` lands in `skippedDates` — no revert, no refund. Final state: `D` is a **paid SCHL day on a cancelled leave**, and one PL day is gone. The amber "skipped" note the UI shows is actively misleading here: it says an admin decision already claimed the day, when in fact the trigger claimed it 200 ms later.

The mitigation already in the code (`index.js:668-670`, re-reading the leave inside the transaction) only covers the mirror ordering — `cancelledDates` committing *before* the transaction's read. It cannot cover the ordering above, because `cancelLeave`'s batch is unconditional: it holds no precondition on the status doc it read at `t3`. This is exactly what `index.js:613-620` documents.

### 1.2 (b) Nightly `plBalance` read/decrement — REAL, wider window than stated

```
index.js:343   usersSnap = await db.collection("users").get()      ← plBalance snapshot, time T0
...
index.js:501   const balance = user.plBalance || 0                 ← uses the T0 value
index.js:502   resolveLeaveStatus(balance) → {SCHL, salaryCredit:1}
index.js:555   await batch.commit()                               ← status docs land
index.js:563   users/{uid}.update({plBalance: increment(-1)})      ← time T1
```

Any `scoreRetroactiveLeave` transaction that commits in `(T0, T1)` reads the *live* balance (still 1), scores its past day paid, and decrements. The nightly then decrements again from its stale view. Net: `plBalance` 1 → −1, **two days paid against one day of balance**. The decrement arithmetic itself is correct (`increment` is atomic); what is wrong is the *paid/unpaid decision* — one of those two days should have been `salaryCredit: 0`.

The brief says "around 23:59–00:00 IST". More precisely the window is `(T0, T1)` — the entire nightly run, which just happens to start at 23:59. It does not require anything to cross midnight. It requires, in the same few seconds: one user on leave *today* whose balance is about to hit 0, **and** a retroactive approval for that same user. Rare, but not midnight-dependent.

Self-healing claim: correct. `accrueMonthlyLeave` (`index.js:305`) does `increment(+1)` unconditionally, so `−1` becomes `0` on the 1st. The *money* does not self-heal: the extra paid day is already in `computeDaysNP`.

### 1.3 (c) Nightly re-run overwrite — the stated mechanism is NOT reachable

The clobber itself is real: `index.js:515` is `batch.set(...)` with **no merge**, and the only skip is `adminOverrides` (`index.js:447`), which tests `markedBy === "admin"` (`index.js:376`). A trigger-written SCHL carries `markedBy: "auto"` (`index.js:679`), so it is not protected — a same-date nightly re-run would rewrite it to `Absent` with `plBalance` already burned, and a full `set` also strips `salaryCredit`, so nothing is left to detect it by.

But the stated *trigger* for it — a Cloud Scheduler retry — cannot produce a same-date re-run:

```js
index.js:340   const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
index.js:341   const today  = nowIST.toISOString().slice(0, 10);
```

`today` is recomputed per invocation. Schedule is `59 23 * * *` IST with `minBackoffSeconds: 60` (`index.js:335-336`). A run that fails at 23:59:xx is retried at ≥ 00:00:xx, where `today` is **D+1**. The retry therefore scores the *next* day and never touches D.

Reachable paths to a genuine same-date second run are narrow: a duplicate delivery of the scheduler's Pub/Sub message (delivery is at-least-once), or an operator force-running the job during day D. Both are rare and neither is what the note describes.

#### 1.3b The bug that finding actually exposes — a failed nightly never scores its own date

Because `today` is wall-clock derived, **a nightly run that throws is never retried for the date it failed on.** `batch.commit()` (`index.js:555`) and the summary `set` (`index.js:580`) are deliberately outside the per-user `try` (`index.js:553-554`), so any infra failure there aborts the whole night. The retry then scores D+1. Consequences for date D:

- **no status docs at all** for D (the whole batch was lost), and
- **no `system/nightly_runs/.../D` document either** — it is written after the commit. So the `ok === false` alarm this repo built for exactly this purpose **cannot fire**; the only signal is a document that does not exist, which nothing is watching.
- The following night does not repair it (the function only ever writes today) — this is the documented failure mode behind the 2026-07-17 backfill (`index.js:438-442`).

This is more likely and has a far larger blast radius than (c) as stated: an entire day unscored for every employee, silently. It is out of scope for this design but is an **open question for the owner (§6 Q1)**.

### 1.4 (d) Midnight no-doc race — REAL

```
23:59:00  nightly starts, today = D. Reads leaves (index.js:358) → snapshot S.
00:00:0x  admin approves L covering D. Trigger fires: todayIST = D+1, so D is "past".
          Trigger txn reads status/D → DOES NOT EXIST (nightly's batch not committed)
          → statusByDate has no entry → planRetroLeaveScoring skips it
            (retroLeaveScoring.js:110: `if (!existing || ...) continue`)
          → logged as missingStatusDates (index.js:691-693), nothing written.
00:00:0y  nightly batch.commit() → status/D = {Absent, auto}, from snapshot S which predates L.
```

`D` stays `Absent` (−2 days NP) forever. The trigger will not re-fire for `L` unless the doc is written again. Confirmed real; requires the nightly run to still be in flight at 00:00 IST, i.e. a run lasting > ~60 s.

At 22 users that run is a few seconds, so this needs a cold start plus a slow `collectionGroup("leave_requests").get()` — note that query has **no `where` clause** (`index.js:358`), so it reads *every leave request ever written* and grows without bound. That is the one component of the run whose duration trends toward the 60 s window over time.

**A more reachable sibling of the same skip:** the trigger's "no status doc → skip" also silently does nothing for any past date that legitimately has no doc — e.g. a date where the nightly failed entirely (§1.3b), or a period when the user was `active === false` (`index.js:346-348`). So (d)'s *mechanism* fires far more often than (d)'s *window* suggests. The `missingStatusDates` warning (`index.js:691`) is the only trace.

### 1.5 A fifth race the brief did not list — leave approved for *today*, during the run

Same window, different date. `L` is approved at 23:59:30 covering **D itself**:

- The trigger computes `todayIST = D`; `pastGrantedDates` is `d < todayIST` (`retroLeaveScoring.js:93`), so D is **not** a candidate → trigger does nothing (correct by design: the nightly owns today).
- The nightly's leave snapshot (`index.js:358`) predates the approval → writes `Absent`.
- No later run ever rewrites D.

Result: an approved leave day scored `Absent` (−2), silently, with no `missingStatusDates` warning and no cancelled/invalid-leave log. This is the same root cause as (d) — **a stale leave snapshot** — and the recommended design closes it for free. Worth telling the owner it exists.

---

## 2. Options

### Option A — one transaction per user, for every user

Each user's status write, `daily_hours` write and `plBalance` decrement become a single transaction that re-reads the user doc, the status doc and the user's leave requests.

| | |
|---|---|
| Closes | (b), (c), (d), (1.5); not (a) |
| Cost | N transactions/night (N ≈ 22 today). ~3 extra reads each. Well inside `timeoutSeconds: 300` even at 200 users (see §2.5). |
| Against | Throws away the one property the current batch has that is worth keeping: **all-or-nothing scoring for the whole company**. Turns one commit into N commits, so a partial night becomes *normal* rather than exceptional. Contends with nothing for ~19 of 22 users (users with punches cannot be affected by leave or balance). Pure overhead for them. |

### Option B — hybrid: fast batch for punch-decided days, transaction for leave/absent days ⭐ RECOMMENDED

Partition by the status the pure scorer produces:

- **`Present` / `HalfDay` / `SL` / `LNF`** — decided entirely by punches. No `plBalance`, and leave never overrides punches in the current rule (`index.js:488-513`: the leave branch is only reached when there are zero punches). Keep these in the existing single `batch`, unchanged — **including all `daily_hours` writes**, because `daily_hours` is only written when both a check-in and a check-out exist (`index.js:525`), which is exactly this partition. Nice property: `daily_hours` never enters a transaction.
- **`Absent` / `SCHL`** — the only users a late leave approval can flip, and the only ones that touch `plBalance`. One transaction each.

| | |
|---|---|
| Closes | (b), (c), (d), (1.5); not (a) |
| Cost | Typically 0–3 transactions/night. Worst case (nobody punched) degenerates to Option A. |
| Against | Two code paths for the same status doc — the schema must be written identically in both or the Sheets export / payroll readers drift. Mitigated by having *one* pure function build the document payload (§3.1). |

### Option C — leave (d) to a different mechanism

Three sub-options, all rejected:

1. **Nightly re-checks approved leave per user** — this is exactly what Option B's in-transaction leave read does, but without the transaction it only narrows the window, never closes it (same reasoning as `index.js:616-620`).
2. **Trigger consults `system/nightly_runs/.../{date}`** — the marker is written *after* the batch (`index.js:580`), so "marker absent" means both "run in flight" and "run failed" and "date never scored"; the trigger cannot distinguish, and would have to either block (it has a 9-minute ceiling and `retry: true`) or guess. It would also have to *create* status docs for dates it knows nothing about — minting `SCHL` docs for dates before an employee joined. Rejected.
3. **Reconciliation pass** (a second nightly job that re-scans approved leave vs. status docs) — a *fifth* writer of payroll statuses, running unattended, with its own races against the other four. The repo's own security posture ("rules are the defence", "a `{path=**}` rule is a second door") argues against adding a second door here too. Rejected unless (b)/(c)/(d) are deliberately left unfixed, in which case a **read-only** reconciliation *report* (writes nothing, flags mismatches into the run summary) is the safe version.

### Option D — `cancelLeave` as a client-SDK `runTransaction` ⭐ RECOMMENDED (orthogonal to A/B/C)

Feasibility checked against the constraints the brief asks about:

| Constraint | Finding |
|---|---|
| **Client SDK transactions cannot run queries.** `transaction.get()` takes a `DocumentReference` only. | `getHolidaysForDateRange` (`firestore.ts:1209-1217`) is a *query* and must either stay outside the transaction or become N per-date `tx.get(doc(db,'holidays',date))`. Per-date reads are allowed: `holidays/{date}` is `allow read: if isLoggedIn()` (`firestore.rules:702-705`). Recommend per-date reads inside the transaction — it removes the last pre-read and costs ≤ N extra reads. |
| **500-entry Commit cap** | ⚠️ *Corrected after review* — the first draft counted only real writes (≤ N status `set`s + `users` + leave = N + 2) and called N = 366 "legal but slow". That undercounts: the client SDK appends one **`verify`** entry to the Commit for every document that was **read but not written** (every `holidays/{date}` doc, and every status doc left alone). The Commit therefore carries about **2N + 2** entries — N status docs (written or verified) + N holiday docs (verified) + the leave + the `users` doc — against Firestore's 500-entry limit. Reads are 1 + 2N. So the ceiling is **N ≈ 249** (2·249 + 2 = 500), and the full worst case N = 366 (a leave's `totalDays` is bounded 1–366 by the rules; `retroLeaveScoring.js` uses `MAX_DAYS = 400`) is **not** legal at all: 734 entries. The cap must stay ≤ ~249; 200 leaves a margin of ~100 entries, not 2.5×. The emulator does not enforce this limit, so it is pinned by a unit test on the arithmetic (`2 * MAX_CANCEL_DATES + 2 < 500`) and the cap is explicit (§6 Q2). |
| **Rules / non-admin Leaves manager** | Unchanged. A transaction is evaluated exactly like a batch: per-operation rules, atomic denial. `users` update is admin-only (`firestore.rules:285-289`), so a `/leaves`-only manager still cannot refund `plBalance` — which is why the button is already gated on `role === 'admin'` (`admin/src/app/(admin)/leaves/page.tsx:60`). Keep that gate. |
| **Rest-day wholesale denial** | Unchanged and still the dominant hazard: `attendance_status` write requires `!isRestDate(date)` (`firestore.rules:463-464`), and a transaction is denied wholesale exactly as a batch is. **The existing date-based `isRestDay` skip (`firestore.ts:430`) must be preserved verbatim.** |
| **Retry semantics** | Client transactions retry (up to 5 attempts) on contention. The callback **re-executes**, so `skippedDates` / `refundedDays` / the merged `cancelledDates` array must be **reset at the top of the callback**. This repo has already been bitten by exactly this shape — see the deliberate `missingStatusDates = 0` reset at `index.js:664` and the "safe to re-execute" test at `migrateLegacyLeaveStatuses.test.js:699`. Top review item. |

**Does it actually close (a)?** Yes. Both writers become transactions that read *and* write the same two documents (`attendance_status/D`, `users/{uid}`), plus the leave doc. Whichever commits second is aborted and re-runs against fresh data:

- trigger first → cancel's transaction aborts, re-reads `{SCHL, salaryCredit:1}`, reverts to `Absent` and refunds. Correct.
- cancel first → the trigger's transaction re-reads the leave (`index.js:668-670`), sees `cancelledDates`, `leaveCoversDate` returns false, scores nothing. Correct.

Mixed optimistic (client) / pessimistic (Admin) transactions are resolved server-side; no special handling needed.

### 2.5 Performance and cost at real scale

Scale from the repo, not assumed: **~22 employees** (`docs/production-readiness-roadmap.md:72` "~22 employees × ~3 punches"; `admin/CLAUDE.md:78` "scanned **all 22 users**, every role, inactive included"; `docs/superpowers/specs/2026-08-01-forecast-entry-tab-design.md:24` "all 22 rows").

Today's nightly, per run: ~22 user docs + today's attendance events (~60) + **every leave request ever written** (unbounded) + 22 status `get`s + ops `planned_hours` + 1 holiday ≈ 150–250 reads; writes = one batch of ≤ 44 + ≤ a handful of `plBalance` updates.

Option B adds, per transactional user: 2 document reads + 1 small subcollection query. Typical night (0–3 such users): **+~10 reads, +3 commits**. Pathological night (all 22 Absent): +~90 reads, 22 commits — run them with `Promise.all` in chunks of 10 and it is < 1 s of added wall clock. At 200 users worst case: 200 commits, chunked → ~4 s. `timeoutSeconds: 300` is untouched by either.

Cost: a few hundred extra document reads per day. Negligible.

**Latent scaling bug worth fixing while here:** the fast batch is one `batch` for the whole company — status + `daily_hours` = up to 2 writes/user, so it hits Firestore's **500-op cap at ~250 ops employees** and would then fail the entire night. Chunk it at 400 ops (§7 task 5). Independent of this design; cheap insurance.

---

## 3. Recommended design

**Option B for the nightly + Option D for `cancelLeave`.** Rationale: it closes every verified race except none, needs no rules change, adds no new writer of payroll data, keeps the single-commit property for the ~85 % of users it is valuable for, and makes the expensive path proportional to the number of people actually on leave.

### 3.1 Nightly — exact new sequence

Phases 1–3 are **unchanged** (`index.js:339-434`): the bulk reads, the `adminOverrides` / `priorStatus` maps, `plannedHours`, the holiday lookup and the rest-day early return all stay exactly as they are.

**Phase 4 — classify (pure, extracted).** Move the body of the per-user loop (`index.js:449-513`) into a new pure module `firebase/functions/nightlyScoring.js`:

```
scoreUserDay({ role, events, plan, leave, plBalance })
  → { status, salaryCredit?, dailyHours? }   // dailyHours only when both punches exist and usesOtShortageLedger(role)
buildStatusDoc({ user, today, status, salaryCredit })
  → the EXACT document written today (index.js:515-520), used by BOTH write paths
```

No behaviour change, no Firestore access, unit-testable with `node --test`.

**Phase 5 — partition.**
- `fast` = users whose `status` ∉ {`Absent`, `SCHL`} → existing `batch.set` of `buildStatusDoc(...)` plus their `daily_hours` doc, committed exactly as today (`index.js:555`).
- `txn` = users whose `status` ∈ {`Absent`, `SCHL`} → one transaction each.

**Phase 6 — per-user transaction** (Admin SDK, so queries inside a transaction are allowed):

```
runTransaction(async tx => {
  // ── all reads first ──
  const [userSnap, statusSnap] = await tx.getAll(userRef, statusRef)
  const leaveSnap = await tx.get(
      userRef.collection('leave_requests').where('status','==','approved'))   // fresh, per-user
  if (!userSnap.exists) return {skipped:'no-user'}

  const prior = statusSnap.exists ? statusSnap.data() : undefined
  if (prior?.markedBy === 'admin') return {skipped:'admin'}    // re-check, closes a regularization race too

  const leave = leaveSnap.docs.map(d => d.data()).find(l => leaveCoversDate(l, today))
  const {status, salaryCredit} = scoreUserDay({..., leave, plBalance: userSnap.data().plBalance})

  // ── writes ──
  tx.set(statusRef, buildStatusDoc({user: {...user, ...userSnap.data()}, today, status, salaryCredit}))
  if (shouldDecrementPlBalance(salaryCredit, prior)) {
    tx.update(userRef, {plBalance: FieldValue.increment(-1)})
    return {status, decremented: true}
  }
  return {status, decremented: false}
})
```

Four things this buys, in order of the problems they solve:

1. **(b)** `plBalance` is read and decremented in one transaction → a concurrent `scoreRetroactiveLeave` transaction on the same `userRef` is serialized, so the second one sees the decremented balance and correctly scores `salaryCredit: 0`.
2. **(c)** The full `tx.set` (no merge) is now *safe*: the doc was read in the same transaction, so if the trigger wrote SCHL after that read, the transaction aborts and re-runs against the SCHL doc. **This is the key reason not to switch to `merge`** — see §3.3.
3. **(d) and (1.5)** The leave set is re-read *inside* the transaction, so an approval that lands during the run is seen, whatever the order: if the approval commits before the transaction's read, the nightly itself scores SCHL; if after, the nightly writes `Absent` and the trigger (which then sees a real doc) converts it.
4. Re-reading `prior` inside the transaction also closes a small unlisted race: a regularization landing between `index.js:373`'s read and the batch commit is currently clobbered.

**Concurrency:** run the transactions with `Promise.all` in chunks of 10. Sequential is also fine at this scale; chunking just bounds the pathological night.

**Phase 7 — delete the post-commit `plDeductions` loop** (`index.js:560-568`). It has no remaining purpose.

### 3.2 Failure handling and the run-summary contract

Keep the contract byte-for-byte. `system/nightly_runs/computeDailyAttendanceStatus/{date}` keeps every key it has today: `date`, `ranAt`, `activeUsers`, `adminMarked`, `expected`, `scored`, `plDeducted`, `plAttempted`, `failures`, `plFailures`, `ok` (`index.js:580-592`).

- A per-user transaction failure is caught, pushed to `failures` as `{userId, employeeId, message}` (same shape as `index.js:548`), and **does not throw** — same reasoning as the existing per-user guard, and `scored` stays the count of users actually written, so `ok` goes false via `scored !== expected`.
- `plAttempted` = number of transactions where `shouldDecrementPlBalance` returned true; `plDeducted` = number that committed. `plFailures` stays in the document (it can only be empty now) so nothing reading the summary breaks. Optionally add `plFailures: []` explicitly with a comment saying it is retained for compatibility.
- **Retry each failed transaction once** before recording it. Firestore `ABORTED` under contention is exactly the expected failure here, and one retry converts it to a success instead of an unscored employee.
- The final `batch.commit()` for the fast partition stays outside the per-user guard and still throws on infra failure (`index.js:553-554`) — unchanged.

**Known regression in failure mode, stated explicitly:** today, a `plBalance` update failure still leaves the status doc written. Under the new design, a transaction failure leaves that user with **no status doc for the day**. For `Absent` that is the safe direction (no −2 wrongly applied); for `SCHL` it means an unpaid leave day. The retry-once rule plus `ok:false` is the mitigation; §6 Q3 asks whether the owner wants a non-transactional status-only fallback on top.

### 3.3 `merge` vs full `set` — the decision, and the trap

**Do not blanket-switch the nightly to `{merge: true}`.** The current full `set` is load-bearing: when a re-run rewrites a day from `SCHL` to `Absent`, the full `set` is what removes the stale `salaryCredit` field. With `merge`, that field survives, and `computeDaysNP` / `tallyAttendanceStatus` (`payrollDeductions.js`) sum `salaryCredit` over `SCHL` days — a stray credit on a non-SCHL doc is currently ignored by payroll, but the field would also survive onto a future `SCHL` rewrite. Switching to merge therefore requires an explicit `FieldValue.delete()` for `salaryCredit` on every non-SCHL write: more code, more ways to get it wrong.

The rule to adopt:

| Path | Write | Why |
|---|---|---|
| Nightly **fast** partition | full `set`, no merge (unchanged) | These users are never written by the trigger (it only writes past dates, and only over `Absent`+`auto`). No clobber risk. |
| Nightly **transaction** partition | full `set`, no merge, **inside a transaction that read the doc** | The transaction's read-precondition is what prevents the clobber, not `merge`. Keeps `salaryCredit` removal correct. |
| `scoreRetroactiveLeave` | `{merge: true}` (unchanged, `index.js:681`) | It deliberately patches only `status`/`salaryCredit`/`markedBy`/`updatedAt` onto a doc whose identity fields it never read. Correct as-is. |
| `cancelLeave` | `{merge: true}` + explicit `deleteField()` on `salaryCredit` (unchanged, `firestore.ts:449`) | Same reason; the explicit delete is already there. Correct as-is. |

### 3.4 `cancelLeave` — exact new sequence

```
// OUTSIDE the transaction: argument validation only (unchanged, firestore.ts:390-394)
runTransaction(db, async tx => {
  // ── reset every accumulator: the callback re-executes on contention ──
  const skippedDates = []; let refundedDays = 0;

  // ── reads (DocumentReferences only — client transactions cannot run queries) ──
  const leaveSnap = await tx.get(leaveRef);
  if (!leaveSnap.exists()) throw new Error('cancelLeave: leave request not found.');
  const leave = {...};
  if (leave.status !== 'approved') throw ...
  const stillGranted = new Set(effectiveGrantedDates(leave));       // re-derived from the IN-TXN copy
  const cancelling = dedupe(datesToCancel).filter(d => stillGranted.has(d)).sort();
  if (cancelling.length === 0) throw ...
  if (cancelling.length > MAX_CANCEL_DATES) throw ...                // §6 Q2
  const statusSnaps  = await Promise.all(cancelling.map(d => tx.get(statusRef(d))));
  const holidaySnaps = await Promise.all(cancelling.map(d => tx.get(doc(db,'holidays',d))));
  const userSnap     = await tx.get(userDocRef);                     // only needed if we ever stop using increment()

  // ── writes: identical decision logic to today (firestore.ts:425-468) ──
  for each date:
      if (isSunday(date) || holidaySnaps[i].exists()) continue;      // silent skip, by DATE — unchanged
      if (!statusSnaps[i].exists()) continue;
      if (status is 'Sunday'|'Holiday') continue;
      if (!scoredAsLeave || markedBy !== 'auto') { skippedDates.push(date); continue; }
      tx.set(statusRef(d), stamped({status:'Absent', markedBy:'admin',
                                     salaryCredit: deleteField(), updatedAt: Timestamp.now()}), {merge:true});
      if ((status==='SCHL' && salaryCredit===1) || status==='PL') refundedDays += 1;
  if (refundedDays > 0) tx.update(userDocRef, stamped({plBalance: increment(refundedDays)}));
  tx.update(leaveRef, stamped({cancelledDates: merged, cancelledBy, cancelComment, lastCancelledAt}));
  return {cancelled: cancelling, skippedDates, refundedDays};
});
```

Changes vs. today, and nothing else:
1. Every read (leave, statuses, holidays) moves **inside** the transaction. `getHolidaysForDateRange`'s range query becomes N per-date `tx.get`s.
2. Accumulators are declared **inside** the callback.
3. The return value comes from the transaction's return value, not from variables closed over outside it.
4. A date-count cap (§6 Q2).

Everything else — the `isRestDay`-by-date silent skip, the `markedBy === 'auto'` gate, the `skippedDates` semantics, the refund rule `(SCHL && salaryCredit===1) || PL`, the `cancelledDates` union, `stamped()` on every write — is **unchanged**, because each one is a decision already argued out in `firestore.ts:320-384` and in `docs/superpowers/specs/2026-08-05-leave-cancellation-design.md`.

### 3.5 Idempotency and retries after the change

| Guard | Behaviour after the change |
|---|---|
| `shouldDecrementPlBalance(salaryCredit, prior)` (`attendanceRules.js:120`) | **Unchanged signature and semantics** — but now called with a `prior` read *inside* the same transaction that does the decrement, so it is no longer advisory. Still the single decision point for "did this day already draw a balance day", still covers the legacy `PL` case. |
| `priorStatus` map (`index.js:371-378`) | Still built in Phase 1, still used to pick the `adminOverrides` skip set. For the transactional partition its value is **superseded** by the in-transaction re-read. Keep the map (the fast partition and the rest-day branch use it) but never let the transaction's decision depend on it. |
| `markedBy: 'auto'` gate (trigger + `cancelLeave`) | Unchanged. Still the invariant that an admin decision is never silently rewritten. |
| `retry: true` on `scoreRetroactiveLeave` | Unchanged; the trigger is untouched by this design. Each retry is still a fresh transaction that re-reads the live leave (`index.js:668-670`). |
| Nightly scheduler retry | Unchanged (and still scores the *next* date — see §1.3b / §6 Q1). A same-date re-run, however it arises, is now safe: each transaction re-reads before it writes. |
| `accrueMonthlyLeave` | Untouched. |

### 3.6 What MUST NOT change

- **`attendance_status` schema.** `buildStatusDoc` must emit the exact field set written today (`index.js:515-520`): `date`, `userId`, `userName`, `employeeId`, `role`, `status`, `salaryCredit` *(only when defined)*, `markedBy: "auto"`, `updatedAt: Timestamp.now()`. Not `serverTimestamp()` — the rest-day branch uses `serverTimestamp()` (`index.js:427`) and the main branch uses `Timestamp.now()`; keep each as-is. Readers depend on `uidOf(doc)` falling back to the parent path, so `userId` must never be dropped.
- **`daily_hours` schema and eligibility** (`index.js:537-541`): `usesOtShortageLedger(role)` **and** both punches. Stays in the fast batch.
- **Sheets export** (`exportToSheets`, `index.js:940`) — Attendance tab, Employee Dashboard month history (`dashboardHistory.js`), OT Exception and Manpower tabs. No change.
- **Payroll mirrors**: `payrollDeductions.js` (`computeDaysNP`, `tallyAttendanceStatus`) and `dailySpend.js` (`STATUS_WEIGHT`, `dayWeight`). Days-NP weights are mirrored in three places and none of them move.
- **OT ledger**: `otLedger.js` / `otAggregate.js` / `wo_ledger` / `ot_approvals` / `settlements` — untouched.
- **Shared rule modules with cross-language mirrors**: `attendanceRules.js` (mirrors `AttendanceStatusRules.kt`), `leaveCoverage.js` (mirrors `leaveDates.ts` + `LeaveRequest.kt`), `roleCapabilities.js` (mirrors two others). This design calls them; it must not edit them. `resolveLeaveStatus` and `shouldDecrementPlBalance` keep their current signatures.
- **`firestore.rules`** — no change required, and none should be made. Run `cd firebase/rules-tests && npm test` before and after anyway.
- **The `system/nightly_runs` summary key set** (§3.2).
- **`cancelLeave`'s admin-only gate** (`leaves/page.tsx:60`) and its rest-day-by-date skip.

---

## 4. Test plan

### 4.1 Pure functions to extract and unit-test (`node --test`, no emulator)

New `firebase/functions/nightlyScoring.js` + `nightlyScoring.test.js`:

| Function | Tests |
|---|---|
| `scoreUserDay({role, events, plan, leave, plBalance})` | **Regression-first**: pin today's behaviour before any refactor — Present / HalfDay (late-in wins over early-out) / SL / LNF (one punch) / Absent (no punches, no leave) / SCHL paid (`plBalance > 0`) / SCHL unpaid (`plBalance === 0`); ops planned-window vs. inverted-window fallback; sales scored on the fixed window across all three in-types; unsorted events. |
| `buildStatusDoc(...)` | Exact field set; `salaryCredit` **absent** (not `undefined`, not `null`) for non-SCHL; `markedBy: "auto"`; deep-equal against a literal copied from `index.js:515-520` — this is the test that stops the two write paths drifting. |
| `partitionUsers(scored)` | `Absent`/`SCHL` → transactional; everything else → fast; a `daily_hours` payload never appears in the transactional set. |
| existing `shouldDecrementPlBalance` | Already covered by `attendanceRules.test.js`. Add a case asserting it is called with the *in-transaction* prior (via the fake, below). |

`admin/src/lib/` — the `cancelLeave` decision logic is worth extracting too: `planLeaveCancellation({leave, datesToCancel, statusByDate, holidaySet})` → `{cancelling, reverts, skippedDates, refundedDays, mergedCancelledDates}`, pure, tested with `npx tsx src/lib/*.test.ts` (the pattern `leaveDates.test.ts` / `otLedger.test.ts` already use). The transaction callback then becomes a thin read/plan/write wrapper, exactly as `scoreRetroactiveLeave` is a thin wrapper around `planRetroLeaveScoring`.

### 4.2 Deterministic race reproduction with the existing fake-Firestore pattern

`firebase/functions/scripts/migrateLegacyLeaveStatuses.test.js:33-215` already contains precisely the harness needed, and it is the pattern to copy rather than reinvent:

- `FakeTx.getAll` **asserts reads precede writes** (`:156`) — catches an illegal transaction shape at unit-test speed.
- `FakeDb.opts.beforeTransaction(db, n)` (`:171-172`) mutates the store **between the scan and the transaction body** — this is the race injector.
- `FakeDb.opts.reexecute` (`:190-193`) runs the callback twice and discards the first run's writes — this is how you prove a callback is safe to re-execute (accumulator resets!).
- `FakeDb.opts.failOnCommit` (`:196`) for the failure-path tests.

A `FakeTx` for this design needs one addition the migration's does not have: `tx.get(query)` returning filtered docs, and a *conflict* model — a write to a doc read by the transaction, injected via `beforeTransaction`, should cause the callback to re-execute (`reexecute`) rather than silently commit stale data.

Race cases to write, each mapping to a numbered problem:

| Test | Injection | Expected |
|---|---|---|
| (b) | `beforeTransaction`: set `plBalance` 1 → 0 (as the trigger's decrement would) | Nightly scores `salaryCredit: 0`, does **not** decrement; balance ends at 0, never −1 |
| (c) | `beforeTransaction`: rewrite `status/{today}` from absent → `{SCHL, salaryCredit:1, markedBy:'auto'}` | With `reexecute`, the transaction re-reads and `shouldDecrementPlBalance` returns false; the doc is not double-drawn |
| (c′) | `beforeTransaction`: rewrite the doc to `{markedBy:'admin'}` | Transaction returns `{skipped:'admin'}`, writes nothing |
| (d) | `beforeTransaction`: add an approved `leave_requests` doc covering `today` | Status flips `Absent` → `SCHL`; `plBalance` decremented once |
| (1.5) | same as (d) but the approval covers today and arrives after the phase-1 snapshot | Same — proves the in-transaction leave read is what matters, not the snapshot |
| failure | `failOnCommit: 2` | User 2 lands in `failures`, users 1 and 3 are still scored, summary `ok: false`, `scored !== expected` |
| re-execute | `reexecute: true` across the whole run | `plDeducted` / `plAttempted` / `failures` are computed from transaction **return values**, never from variables mutated inside the callback (the `index.js:664` lesson) |

### 4.3 Emulator tests

The functions package has **no emulator harness today** (`"test": "node --test"`, no `firebase-functions-test` usage in the suites). Two options:

1. **Recommended, cheap:** add `firebase/functions/emulator-tests/` with its own `package.json` mirroring `firebase/rules-tests/package.json` — `"test": "firebase emulators:exec --only firestore --project whitecoffee-fn-test \"node --test\""` — and talk to the emulator with the **Admin SDK** pointed at `FIRESTORE_EMULATOR_HOST`. This exercises real transaction semantics (real `ABORTED`, real contention, real 500-cap) that no fake can. Tests to run there:
   - two concurrent transactions decrementing the same `plBalance` → exactly one decrement, no `−1`;
   - a genuine `cancelLeave`-vs-`scoreRetroactiveLeave` interleave, driven by two clients against one emulator;
   - the fast batch at 400+ writes (cap behaviour);
   - `cancelLeave` with a rest date in range → still denied wholesale under real rules (regression on the existing hazard).
2. **Minimal:** skip the new package and keep the fake-Firestore tests only. Acceptable for the nightly (fully deterministic under the fake) but **not** for `cancelLeave`, because the interesting part there is rules + client-transaction retry, which the fake cannot model. `firebase/rules-tests` is the natural home for that one — it already boots the emulator with the real rules and a client SDK.

**Recommendation:** put the `cancelLeave` transaction test in the existing `firebase/rules-tests` suite (zero new infrastructure, real rules, real client SDK), and keep the nightly on fake-Firestore unit tests. Add option 1 only if the emulator suite earns its keep later.

### 4.4 Regression tests that pin CURRENT behaviour first

Written and green **before** any production code moves:

- `scoreUserDay` golden cases (§4.1) — captured from the current inline logic.
- `buildStatusDoc` deep-equal against the literal at `index.js:515-520`.
- `daily_hours` payload deep-equal against `index.js:537-541`, including `shortageMins`/`otMins` arithmetic.
- Run-summary document deep-equal (key set + `ok` computation) against `index.js:580-592`.
- `cancelLeave`: a table-driven test over every branch of the current loop (rest date, no doc, Sunday/Holiday doc, non-leave status, `markedBy:'admin'`, paid SCHL, unpaid SCHL, legacy `PL`, legacy `LWP`, `USCHL`) asserting the exact `{cancelled, skippedDates, refundedDays}` triple. This is the safety net for the whole `cancelLeave` change.
- `cd firebase/rules-tests && npm test` (110 tests) before and after — required by the root CLAUDE.md for anything near the security boundary, even though no rule changes.

---

## 5. Risk assessment and rollout

### 5.1 What could go wrong in production

| Risk | Likelihood | Blast radius | Detection | Mitigation |
|---|---|---|---|---|
| Transaction path writes a different document shape than the batch path | Medium (two code paths) | Sheets columns blank / payroll miscounts for leave days | `buildStatusDoc` deep-equal test; spot-check the Attendance tab the morning after deploy | Single `buildStatusDoc` used by both paths — no second literal anywhere |
| Accumulator not reset in a re-executing callback → double refund / double-counted `plDeducted` | Medium (classic, and this repo has hit it) | Minted leave balance | `reexecute` test | Return values only; never close over mutable state |
| Per-user transaction fails → that user has **no** status doc | Low | One employee, one day; unpaid leave if it was SCHL | `ok:false`, `scored !== expected` in the run summary | Retry once; §6 Q3 |
| Contention storm (nightly txn vs. trigger vs. a portal edit) | Low | Some users unscored | Same | Chunked concurrency; retry once |
| `cancelLeave` transaction exceeds limits on a huge range | Low | The cancel fails cleanly (atomic) — no partial state | The thrown error surfaces in the portal | Explicit date cap with a clear message |
| A `{merge:true}` creeps into the nightly during review | Low | Stale `salaryCredit` on rewritten docs | `buildStatusDoc` / rewrite regression test | §3.3 is explicit; make it a review checklist item |

**Non-risk worth stating:** none of this changes `firestore.rules`, the `attendance_status` schema, `daily_hours`, the Sheets export, the OT ledger or any of the three-way-mirrored rule modules. A rollback is a pure redeploy.

### 5.2 Rollback

- `cancelLeave` — `npm run deploy` of the previous commit (static export + hosting). Instant. No data migration: the documents it writes are byte-identical to today's.
- Nightly — `firebase deploy --only functions` of the previous commit. The status docs it wrote are schema-identical, so there is nothing to undo. The one irreversible failure mode is a **wrong `plBalance`**; if that happens, it is a single-field admin correction on the user doc, and the audit log (`auditUserSubcollection`) has the before/after.

### 5.3 Order of changes — smallest safe step first

1. **Extract + pin (no behaviour change).** `nightlyScoring.js` + regression tests; `index.js` calls it. Deploy, watch one night, confirm `system/nightly_runs/.../{date}.ok === true` and the Sheets Attendance tab is unchanged.
2. **`cancelLeave` → `runTransaction`** (+ pure `planLeaveCancellation` + rules-suite test). Closes **(a)**. Smallest blast radius, one function, one client deploy, immediately verifiable by performing a real cancellation in the portal and checking the `plBalance` delta.
3. **Nightly hybrid transaction.** Closes **(b)(c)(d)(1.5)**. Deploy on a day someone can watch the 23:59 run and read the summary doc.
4. **Chunk the fast batch at 400 writes** (latent 500-cap bug, independent).
5. **Do not** build a reconciliation pass.

### 5.4 Which of (a)–(d) are worth fixing at all

| | Fix? | Why |
|---|---|---|
| **(a)** | **Yes — fix.** | Real money in both directions (a cancelled day paid *and* a PL day burned), the window is a whole trigger invocation, and "approve, then immediately cancel" is a plausible human sequence. The fix is self-contained in one client function and is independently testable and rollback-able. |
| **(b)** | **Yes — fix**, as a by-product. | One extra paid day per occurrence. Would not justify a redesign on its own, but it costs nothing once the per-user transaction exists. |
| **(c)** | **No — do not build anything for it.** | The stated mechanism is not reachable (§1.3). It closes for free under the recommended design. **But escalate §1.3b** — "a failed nightly never scores its own date, and writes no summary doc, so the `ok:false` alarm cannot fire" is a real and much larger gap, and it deserves its own decision (Q1). |
| **(d)** | **Yes — but only because it is free.** | On its own likelihood (an approval landing in a < 1 s window during a run that must last > 60 s) it would be a "document and move on". It is worth fixing here because the same in-transaction leave read also closes **(1.5)**, whose window is the whole run and which nobody had listed. |

If the owner wants the **minimum** intervention: do step 2 only (fix (a)), and leave (b)(c)(d) documented as they are today. That is a defensible choice — (a) is the only one of the four that a person can plausibly trigger by doing their job at normal speed.

---

## 6. Open questions for the owner

**Q1. The §1.3b finding — a failed nightly never scores its own date, and leaves no run-summary doc, so the existing `ok:false` alarm cannot fire. Fix it in this change, split it out, or accept it?**
*Recommendation:* **split it out as its own small change, and do it soon** — it is larger than any of (a)–(d). Two cheap parts: (i) write a `started` marker into `system/nightly_runs/.../{date}` at the *top* of the run so a run that never finished is detectable by absence-of-`ranAt` instead of absence-of-document; (ii) derive `today` from the scheduled time where the platform provides it, or refuse to run if `today` has drifted from the scheduled date, so a retry either repairs D or fails loudly rather than silently scoring D+1.

**Q2. Cap on dates per `cancelLeave` transaction?**
*Recommendation:* **200**, with a clear thrown message ("cancel in smaller batches"). ⚠️ The ceiling is **~249**, not 366: the Commit carries ~2N + 2 write/verify entries (see the Option D table, "500-entry Commit cap"), so a whole-year (366-date) cancellation cannot commit in one transaction at all and must be done in two chunks. 200 keeps ~100 entries of margin; never raise it above ~249. Cancelling 200+ days in one action is not a real workflow anyway — the UI picker is per-date.

**Q3. On a per-user transaction failure, should the nightly fall back to writing the status doc alone (non-transactionally), so the user is never left with no doc?**
*Recommendation:* **No.** Retry the transaction once, then record the failure. A non-transactional fallback reintroduces exactly the unguarded write this design removes, and it would fire precisely when there is contention — i.e. when another writer is mid-flight. A missing doc surfaced by `ok:false` is better than a wrong doc written silently.

**Q4. Should `collectionGroup("leave_requests").get()` (`index.js:358`, no `where`) be narrowed in this change?**
*Recommendation:* **No — separate change.** It is the component of the run whose duration grows without bound and therefore the thing most likely to widen the (d)/(1.5) window over time, but narrowing it with a date filter needs a collection-group `fieldOverride` in `firestore.indexes.json` or the deploy prunes it (a documented trap in this repo). Do it deliberately, with its own verification. A `where("status","==","approved")` alone is a safe first cut.

**Q5. Is anything actually watching `system/nightly_runs/.../{date}.ok`?**
*Recommendation:* the whole failure story of this design (and of the existing code) rests on that document. **Wire a real alert** — a log-based alert on the existing `console.error` lines is the zero-infrastructure version.

**Q6. Should `scoreRetroactiveLeave` create a status doc for a past granted date that has none, instead of skipping?**
*Recommendation:* **No.** It would mint `SCHL` docs for dates before an employee joined, for offboarded periods, and for rest days. The nightly transaction closes the *race* version of that skip; the remaining cases are genuinely unscored days and belong to Regularization. Keep the `missingStatusDates` warning as the signal.

**Q7. Add a Firestore-emulator test package for `firebase/functions`?**
*Recommendation:* **Not yet.** Put the `cancelLeave` transaction test in the existing `firebase/rules-tests` suite (real rules, real client SDK, zero new infrastructure) and keep the nightly on fake-Firestore unit tests. Revisit if a second function needs real transaction semantics.

---

## 7. Task breakdown (subagent-driven build)

Each task ends green: `cd firebase/functions && node --check index.js && npm test`, plus `npx tsx src/lib/<file>.test.ts` for admin tasks, plus `cd firebase/rules-tests && npm test` for anything after task 4.

| # | Task | Files | Tests | Review focus |
|---|---|---|---|---|
| 1 | **Pin current behaviour.** Extract `scoreUserDay` / `buildStatusDoc` / `partitionUsers` into `nightlyScoring.js`; `index.js` calls them. Zero behaviour change. | `firebase/functions/nightlyScoring.js` (new), `index.js:446-543` | `nightlyScoring.test.js` (new): golden status cases, `buildStatusDoc` deep-equal vs. `index.js:515-520`, `daily_hours` deep-equal vs. `:537-541` | The extracted document literal must be **identical**, field for field, including `Timestamp.now()` vs. `serverTimestamp()`. Diff the payloads, do not eyeball them. |
| 2 | **Pin `cancelLeave`.** Extract `planLeaveCancellation` (pure); `cancelLeave` calls it, still non-transactional. | `admin/src/lib/leaveCancellation.ts` (new), `firestore.ts:386-472` | `leaveCancellation.test.ts` (new, `npx tsx`): the full branch table from §4.4 | The refund rule and the rest-day-by-date skip must come out of the extraction unchanged. |
| 3 | **`cancelLeave` → `runTransaction`.** All reads inside; holidays per-date `tx.get`; accumulators inside the callback; date cap. | `admin/src/lib/firestore.ts` | Reuse task 2's tests; add a re-execution test (call the callback twice, assert one result); add an emulator test in `firebase/rules-tests` for the admin-only + rest-day-denial behaviour | **Accumulator resets** (the `index.js:664` lesson). No query inside a client transaction. `stamped()` still on every write. UI gate at `leaves/page.tsx:60` unchanged. |
| 4 | **Nightly hybrid.** Partition; per-user transaction with the §3.1 read/write order; delete `plDeductions` (`index.js:560-568`); keep the summary key set. | `firebase/functions/index.js:436-592` | New fake-Firestore race suite (§4.2), modelled on `scripts/migrateLegacyLeaveStatuses.test.js:33-215`; summary-document deep-equal | Reads before writes; `shouldDecrementPlBalance` called with the **in-transaction** prior; full `set` (**not** merge) inside the transaction; `failures`/`plFailures`/`ok` contract preserved; results taken from transaction return values. |
| 5 | **Chunk the fast batch at 400 writes.** Independent latent 500-cap fix. | `firebase/functions/index.js` (fast batch + rest-day batch at `:406-431`) | Fake-Firestore test at 401 and 1001 writes | Chunk boundaries must not split a user's status and `daily_hours` in a way that changes failure semantics — or state plainly that it can, and that the summary reports it. |
| 6 | **Docs.** Update `admin/CLAUDE.md` (Leaves Page section) and `docs/cloud-functions.md` to describe the transactional nightly; delete the now-stale "two KNOWN, deliberately-unfixed races" note at `index.js:613-624` and replace it with what remains true. | docs + the `index.js` comment block | — | Do not leave a comment claiming a race is unfixed when it is fixed — that comment is how the next reader decides what to trust. |

Tasks 1 and 2 are independent and can run in parallel. 3 depends on 2; 4 depends on 1; 5 and 6 come last.
