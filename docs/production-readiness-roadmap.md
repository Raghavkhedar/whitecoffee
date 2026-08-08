# Production-Readiness Roadmap — WhiteCoffee

**Audit date:** 2026-08-06 · **System status:** fully live, real payroll
**Scope:** `android/` + `admin/` + `firebase/` against project `white-coffee-92c27`

---

## Executive summary

This is not a project that needs to be "made production-grade" from scratch. The domain
logic is already better engineered than most systems of this size: 227 passing unit tests
in `firebase/functions`, 11 test files in `admin/src/lib`, 36 JVM tests on Android, a
72-test Firestore rules emulator suite, design docs preceding major changes, and the
load-bearing invariants pinned in `CLAUDE.md` rather than living in someone's head.

**The pure logic is well tested. The infrastructure around it is not there at all.**

Every serious risk found sits in the gap between the tested pure modules and the
untested orchestration, deployment, and recovery layers that wrap them. The single
highest-severity finding — an unguarded nightly payroll job — is the same bug class that
already required a 22-document manual backfill in July 2026.

**Findings by severity:** 3 critical · 4 high · 5 medium

---

## Critical findings

### C1 — The nightly payroll job has zero error handling, and a failed night is never recovered

`computeDailyAttendanceStatus` (`firebase/functions/index.js:230-419`) contains **no
`try`/`catch` anywhere in its 190 lines**. It iterates every active user in a bare
`for` loop and writes the `attendance_status` doc that determines that employee's pay
for the day.

One malformed user document, one unexpected `null`, one transient Firestore error
mid-loop, and the function throws. When it throws:

- Every employee **after** the failure point gets no status doc for that day.
- The function has **no `retryConfig`** (`grep retryConfig index.js` → 0 matches), so
  Cloud Scheduler does not re-run it.
- The job **only ever writes today** — tomorrow's run will not repair yesterday.
- Nothing alerts anyone. There are 4 `console.error` calls in a 2,330-line file and no
  error-reporting integration.

The result is silent, permanent, unpaid days. This is not hypothetical: the July 2026
backfill (`markedBy: 'backfill'`, 22 docs, 5 employees) exists precisely because a
different bug caused days to go unscored and nobody noticed until later.

**Fix:** wrap the per-user body in `try`/`catch` so one bad user cannot poison the run;
add `retryConfig` to the schedule; write a per-run summary doc (`system/nightly_runs/{date}`)
recording users processed vs. expected; alert on mismatch.

---

### C2 — 21 unbounded full-collection reads run every night and grow forever

Twenty-one `collectionGroup(...).get()` calls in `index.js` have **no `.where()` filter**.
They read the entire collection, for all time, on every scheduled run:

| Line | Collection read in full | Grows by |
|---|---|---|
| 740, 1818 | `attendance` | every punch, forever |
| 252, 1202 | `leave_requests` | every leave ever filed |
| 665, 1816 | `attendance_status` | one doc/employee/working day |
| 689, 1820 | `planned_hours` | one doc/ops employee/day |
| 703, 1822 | `ot_approvals` | every OT decision |
| 650, 1664 | `compensation` | bounded (one/employee) |
| 1363, 1679 | `specialAllowance` | one/employee/month |
| 1098-1188 | material/tool/work_progress | every submission |

`attendance` is the dangerous one. At ~22 employees × ~3 punches × ~300 working days,
that is roughly **20,000 documents per year, re-read in full every single night** — by
`exportToSheets` (540s timeout) and `snapshotDailySpend` (300s timeout) both.

This is a time bomb on a fuse of calendar time, not load. It does not degrade gracefully:
it works fine until one night it exceeds the timeout, and then it fails exactly like C1 —
silently, with no retry, on the job that decides pay. Cost also scales linearly (Firestore
bills per document read).

**Fix:** add `.where("date", ">=", monthStart)` / `<=` bounds to every month-scoped read.
Most of these functions only ever use the current month's data — they are already
discarding the rest after reading it.

---

### C3 — One Firebase project: there is no environment to fail in

`.firebaserc` defines exactly one project, `white-coffee-92c27`. There is no staging,
no dev project, and **no CI** (`.github/workflows` does not exist).

Consequences, all of which apply today:

- `firebase deploy` from a laptop pushes rules + functions **straight to the environment
  holding real payroll data**. A typo in `firestore.rules` locks out every employee or
  opens their salaries — both have precedent in this codebase's own history.
- The 72-test rules suite requires the Firebase CLI + Java emulator installed locally.
  Nothing enforces that it ran. It is one skipped step from being decorative.
- The `admin` test files (11 of them) have **no `npm test` script and no test runner
  installed** — they are run by hand with `npx tsx`, one file at a time. Nothing catches
  it when someone forgets.
- There is no automated Firestore backup configured. A bad migration script — and this
  repo has run several (`backfill-attendance-tz.js`, `seed_conveyance.js`, a deleted
  backfill HTTP function) — is unrecoverable.

**Fix:** second Firebase project as staging; GitHub Actions running all four test suites
on every PR; scheduled Firestore export to GCS with 30-day retention.

---

## High findings

### H1 — No crash or error reporting on any of the three surfaces

Android ships `firebase-analytics` but **not Crashlytics**. A crash on an employee's
phone at check-in time is completely invisible — the employee simply doesn't get punched
in, and the nightly job scores them Absent (−2 days NP). There is no Error Reporting or
alerting on Cloud Functions either. **Today, the first person to notice a payroll bug is
the employee whose salary is wrong.**

### H2 — Deploys are manual, unversioned, and unattributed

No CI means no record of who deployed what, when. Functions, rules, hosting, and the
Android app each deploy by a different manual command. There is no tagged release
correlating an APK version to the functions revision it expects. Rollback is "re-run the
old command from an older checkout, if you can find it."

### H3 — The three-way mirror is enforced only by convention

`roleCapabilities` is duplicated across `functions/roleCapabilities.js`,
`admin/src/lib/roleCapabilities.ts`, and Android `RoleCapabilities.kt`. **The audit
confirms all three currently agree on all 8 axes** — good. But nothing *enforces* it: three
languages, three test runners, no shared build graph, no CI running all three. The same
applies to `leaveCoverage` (3 copies) and the attendance rule (documented as having a
**4th** client-side copy in `deriveStatus`). Drift here is a payroll bug, and the failure
mode is silent.

### H4 — `exportToSheets` is 920 lines with one `try` block

The single largest function in the codebase writes to three separate Google Sheets,
computes payroll deductions, and freezes month history. It has one try/catch. A Sheets API
hiccup partway through can leave a month block half-written — and the freeze logic treats
past blocks as immutable, so a corrupted freeze is permanent.

---

## Medium findings

- **M1 — `specialAllowance` is undocumented.** It is implemented (`index.js:1363, 1679`),
  rules-tested (`rules-tests/specialAllowance.test.js`), and feeds settlement cash — but
  appears **zero times** in either `CLAUDE.md`. The docs are otherwise excellent; this is
  live drift.
- **M2 — Dependency currency.** `admin` runs Next 14.2.3 / firebase-js 10.x while functions
  run firebase-admin 13.x on Node 24. No Dependabot, no audit step.
- **M3 — Stale eslint in functions.** Documented as parse-erroring on modern syntax, so
  `npm run lint` is a broken script that exists and is skipped. Either fix or remove it.
- **M4 — `maxInstances: 10` global.** Fine now; worth revisiting alongside C2.
- **M5 — `android/.idea/misc.xml` tracked and dirty.** IDE state in version control.

---

## Phased plan

Ordered by **risk removed per hour spent**, not by size. Phases 0 and 1 address every
critical finding and can be done without touching business logic.

### Phase 0 — Stop the bleeding (~1 day, no logic changes)

| # | Action | Fixes |
|---|---|---|
| 0.1 | `try`/`catch` around the per-user body of `computeDailyAttendanceStatus`; log and continue | C1 |
| 0.2 | Add `retryConfig` to all scheduled functions | C1 |
| 0.3 | Enable scheduled Firestore export to a GCS bucket, 30-day retention | C3 |
| 0.4 | Add Crashlytics to the Android app | H1 |
| 0.5 | Alert policy on Cloud Functions error rate → your email | H1 |

**Highest leverage in the whole document.** 0.1 + 0.2 are a few dozen lines and close the
exact failure that already cost a manual backfill. 0.3 is console configuration, not code.

### Phase 1 — Make correctness enforceable (~2-3 days)

| # | Action | Fixes |
|---|---|---|
| 1.1 | `npm test` script + `tsx`/`vitest` in `admin` so its 11 test files actually run | C3 |
| 1.2 | GitHub Actions: functions tests, admin tests, rules emulator suite, Android unit tests, both builds — on every PR | C3, H2, H3 |
| 1.3 | Cross-language parity test: a shared JSON fixture all three `roleCapabilities` suites assert against | H3 |
| 1.4 | Nightly run summary doc + alert when processed ≠ expected | C1 |
| 1.5 | Branch protection on `main` requiring green CI | H2 |

After this, the drift and skipped-test risks stop depending on discipline.

### Phase 2 — Environment separation (~2-3 days)

| # | Action | Fixes |
|---|---|---|
| 2.1 | Create `whitecoffee-staging` Firebase project; add to `.firebaserc` as an alias | C3 |
| 2.2 | Seed staging with anonymised data (never a copy of real pay) | C3 |
| 2.3 | Deploy pipeline: merge → staging automatically; production behind manual approval | C3, H2 |
| 2.4 | Tagged releases correlating APK versionCode ↔ functions revision | H2 |

### Phase 3 — Remove the scaling bomb (~2-3 days)

| # | Action | Fixes |
|---|---|---|
| 3.1 | Add date bounds to all 21 unbounded `collectionGroup` reads | C2 |
| 3.2 | Add the composite indexes those filters need | C2 |
| 3.3 | Load-test the nightly job against a synthetic 5-year dataset | C2 |
| 3.4 | Split `exportToSheets` into per-sheet functions, each independently retryable | H4 |

Deliberately after Phase 1: these touch money-affecting reads, and they should not be
done until CI can prove nothing broke.

### Phase 4 — Hygiene (ongoing)

Document `specialAllowance` in `admin/CLAUDE.md` (M1) · Dependabot (M2) · fix or delete
the functions eslint config (M3) · untrack `.idea/` (M5) · revisit `maxInstances` (M4).

---

## What this does *not* need

Worth stating, because production-readiness checklists tend to sprawl:

- **No Kubernetes, no microservices, no Terraform.** Firebase is the right platform for
  this and the architecture is sound.
- **No rewrite of anything.** Every finding is additive.
- **No test-coverage mandate.** Coverage is already good where it matters (pure logic).
  The gap is orchestration and infrastructure, and chasing a coverage percentage would
  point effort away from that.
- **No global state / framework migration in `admin`.** Local `useState` is fine at this
  scale.

---

## Recommendation

Do **Phase 0 this week**. It is roughly one day of work, changes no business logic, and
eliminates the failure mode most likely to put a wrong number on someone's payslip — a
failure mode this system has already experienced once.

Everything after that can be scheduled at whatever pace suits, but Phase 1 should precede
Phase 3: do not modify payroll reads until CI can prove the modification was safe.

---

*Audit basis: `firebase/functions/index.js` (2,330 lines), `firestore.rules` (621 lines),
`admin/src/lib/` (29 files), `android/` (143 Kotlin files), 273 commits, all test suites
enumerated and the functions suite executed (227/227 passing).*
