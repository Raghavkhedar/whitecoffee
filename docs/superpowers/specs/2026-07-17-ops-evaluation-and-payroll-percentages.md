# Ops evaluation model + payroll percentages — decisions

**Date:** 2026-07-17 (decisions answered same day)
**Status:** 🟢 ALL FOUR ANSWERED. Read this before touching ops attendance scoring or the
Employee Dashboard payroll columns.

This captured a discussion that was cut short; the four open questions were put back to the user
on 2026-07-17 and all four are now answered. Each section below records the **answer** and what
was done about it.

## Answers at a glance

| # | Question | Answer | Code change |
|---|---|---|---|
| 1 | Evaluate every ops day Mon–Sat? | **Yes — blank day = Absent** | ✅ done (`shouldEvaluateDay` deleted) |
| 2 | Rest-day OT automatic or authorized? | **Authorized — the gate stays** | none — code was already right |
| 3 | Is a WO netting to ₹0 without OT intended? | **Yes, intended** | none — code was already right |
| 4 | Is the PF/ESI base Salary Due MTD? | **Yes — `daysNP × salaryRate`** | ⬜ to build |

Two of the four resolved *against* the model as originally stated (2 and 3): the code was correct
and the verbal spec was wrong. That is why they are recorded here rather than silently left alone —
without this note the next reader would see the same divergence and "fix" it.

---

## Already shipped today (context — don't redo it)

| PR | What |
|---|---|
| #15 | "End Day" now confirms before writing the terminal `home_out` |
| #16 | Ops days worked with **no planned shift** now score against the default 10:00–18:00 |
| #17 | PF/ESI/Imprest **fields** on `/users` (inert — nothing reads them) + Attendance tab scores no-plan days |
| #18, #23 | Docs: the backfill record; the OT ledger's inverted-window claim was false |
| #19, #20, #22 | The scoring rule is now one copy per language, all three asserting against a shared case file |
| #21 | Logout that would end an open day now confirms |
| #24 | v1.8 released to the `employees` group |

Also: **22 lost ops days were backfilled** (~₹19,000, 5 employees, `markedBy: 'backfill'`) — see
`admin/CLAUDE.md`. And **the scoring rule now has a shared case file**:
`firebase/functions/attendance-rule-cases.txt`. Add cases THERE, never in a language-specific
test — JS, TS and Kotlin all read it.

---

## The model the user stated

Verbatim intent, 2026-07-17:

1. **Monday–Saturday are working days.**
2. **If a planned shift is entered, evaluate on that; if not, evaluate on the default 10:00–18:00.**
3. **On Sundays and holidays, all work done goes straight to OT.**
4. **WO is treated as it currently is** (see below — needs confirming).

Point 2 is already live (#16, #22). Points 1, 3 and 4 are where the code and the model diverge.

---

## Decision 1 — flip ops to "always evaluated" (Mon–Sat) — ✅ ANSWERED YES, BUILT

**Answered 2026-07-17: yes, mark them Absent.** Built the same day — `shouldEvaluateDay` is gone
from `attendanceRules.js`, its call site in `index.js`, and the mirrored guard in the portal's
`deriveStatus`. The five unit tests went with it: the predicate became `() => true`, so the unit
disappeared along with the decision it modelled. **Net effect: the "no punches → Absent" rule is
now untested** — it lives in `index.js`, which has no test harness (the boundary suite is pure
functions only). The remaining skips (Sunday, holiday, `active !== false`, admin override) are all
function-level guards, unchanged and also untested.

**The 63 past days were left alone**, per the recommendation below — not re-scored, not backfilled.

### Behaviour before the flip (kept for context)

`shouldEvaluateDay` in `firebase/functions/attendanceRules.js`:

```js
if (fixedWindow) return true;                          // office/admin/sales: always
return Boolean(hasPlan || hasLeave || worked);          // ops: only these three
```

So an ops day with **no plan, no leave, no punches** is treated as *unscheduled*: no status doc,
blank in the portal, no penalty. Office/admin/sales are always evaluated and so a no-show there
already scores Absent.

**This predates today's work** — the old code was `if (!fixedWindow && !plan && !leave) continue;`,
which skipped the same days. #16 only changed the case where they *did* work.

### What the user wants

Every ops day evaluated Mon–Sat. Plan if present, else 10:00–18:00. No punches + no leave →
**Absent**. Concretely: Vishnu (S369) and Shivam Kumar (S450) have no plan and no punches on
2026-07-14/15/16, and the user expects those to read Absent. They currently render blank.

### Implementation

Remove the `worked` guard. With it gone `shouldEvaluateDay` is always-true dead code — delete it
and the `continue` in `index.js` entirely; ops then behave exactly like office. Also drop the
mirrored guard in `deriveStatus` (`admin/src/app/(admin)/attendance/page.tsx`) — the
`if (!fixedWindow && !hasPlan && !worked) return null;` line.

### ⚠️ Why this was NOT done without confirmation

**Absent is −2 days NP**, not zero (`present + SL×0.75 + halfDay×0.5 + LNF×0.5 + PL − absent×2`).
So a legitimately-off day that nobody marks becomes a **two-day pay cut**.

The real change is operational, not arithmetic: admins must then mark **every ops day** — a plan
for working days, WO or leave for days off. A forgotten entry stops being silent and starts
costing the employee money. Confirm the business is ready for that.

### ⚠️ Open sub-question: the 63 past days

A read-only scan of 2026-07-01..16 found **63 ops-days with no punches at all**, currently blank.
Under the new rule they are all Absent — roughly **−126 days NP** across 5–7 people, which would
wipe out the ~19 days just recovered several times over.

**Recommendation: leave them.** You cannot retroactively distinguish "was off" from "didn't use
the app", and 63 of 98 possible ops-days having zero punches looks like inconsistent app usage,
not 64% absenteeism. Some also fall **before the employee joined** (Shivam created 2026-07-10,
Vishnu 2026-07-04) — they'd be marked Absent for days they didn't exist. Note the nightly only
ever writes *today*, so going forward this problem doesn't recur; it's purely about history.

---

## Decision 2 — is rest-day OT automatic or authorized? — ✅ ANSWERED: AUTHORIZED, NO CHANGE

**Answered 2026-07-17: keep the gate exactly as the code has it.** The verbal model ("all Sunday
work goes straight to OT") was the thing that was wrong, not the code. Nothing was built. Do not
remove the `otAuthorized` gate — an employee must not be able to create OT liability by turning up
unasked. Recorded in `admin/CLAUDE.md` so it isn't re-litigated.

### The divergence that prompted the question (kept for context)

The user said *"on holidays and sundays all the work done is going straight to OT"*. The code
disagrees — `computeDayLedger` in `admin/src/lib/otLedger.ts`:

```ts
if (i.isRestDay) {
  if (i.otAuthorized) return { ...ZERO, restDayOtMins: worked };
  return { ...ZERO, unauthorizedRestDay: true };   // 0 OT credited
}
```

Rest-day work credits OT **only when an admin has toggled "Authorize OT"** (`planned_hours.otAuthorized`,
which replaces the shift inputs on Sundays/holidays). Unauthorized Sunday work credits **zero** and
is flagged "unauthorized" in the OT/Shortage modal.

The question was whether that gate was intentional. It is. **Resolved: authorized.**

---

## Decision 3 — WO semantics — ✅ ANSWERED: INTENDED, NO CHANGE

**Answered 2026-07-17: yes, a WO netting to ₹0 without OT is intended.** The WO is advance credit
against hours the employee is expected to make up as OT that month. Nothing was built; the −480
debit stays. Recorded in `admin/CLAUDE.md`.

### The shape that prompted the question (kept for context)

Understanding to confirm (from `admin/CLAUDE.md` + `otLedger.ts`):

- WO = admin-set paid no-work day off for ops (`markedBy: 'admin'`), set on the Attendance page or
  as a regularization outcome.
- It is **not** in Days NP.
- It debits a standard 8h (`WO_DEBIT_MINS`) from the monthly ledger, repayable by OT that month.
- It settles as `settlementCash = woDays × rate + netMins/480 × rate`.

Those two combine so that **a WO with no OT nets to zero**. One WO, no overtime → `netMins = −480`
→ `settlementCash = rate − rate = 0`. So the employee only keeps WO pay if they worked 8h of OT
elsewhere that month. That looked like a strange shape for a "paid day off", which is why it was
raised — **confirmed intended.**

---

## Decision 4 — PF / ESI / Imprest wiring — ✅ BLOCKER ANSWERED, READY TO BUILD

Fields exist on the user doc and save from the `/users` modal (#17). **Nothing reads them.**

### Spec as stated by the user (2026-07-17)

- `PF = MTD salary × pfPercent%` — salary ₹100, PF 8% → ₹8
- `ESI = MTD salary × esiPercent%` — same shape
- Both **MTD**, accumulating like salary
- `Imprest = (MTD salary × imprestPercent%) × efficiency%`
- **PF and ESI are DEDUCTED from TOTAL DUE.** Today
  `TOTAL DUE = salaryDue + covy + imprest + settlement`; it becomes `− PF − ESI`.
- **The computed Imprest REPLACES the manual Imprest column** currently typed into the Sheet and
  carried across runs by `imprestFromBlock` (`firebase/functions/dashboardHistory.js`).

### The efficiency matrix

**Does not exist anywhere in the codebase** — searched; the only `matrix` hits are the tab-access
matrix and Google's distance-matrix API, both unrelated.

User's instruction: **keep the efficiency field visible as a reminder to populate it later, and
use a value of 1 (100%) for now.** So `Imprest = MTD salary × imprestPercent%` until it's real.

That default matters: without it, an unpopulated efficiency means `× 0`, and since the computed
Imprest *replaces* the manual column, **every employee's imprest would silently become ₹0**.

Still unknown for later: what the efficiency matrix actually is (the Manpower Utilisation report's
`work done-time` = `(site_out − site_in)/480`? a manual spreadsheet? a new field?), and whether
it's per-employee-per-month or a daily average. Note that manpower fraction is **uncapped and can
exceed 1**, so if it becomes the source, a >100% month would pay more than the full imprest slice.

### ✅ THE BLOCKER — ANSWERED 2026-07-17

**The base IS "Salary Due MTD"** — `daysNP × salaryRate`, what they have actually earned so far
this month. Confirmed by the user against a worked example: someone at ₹1,000/day with 14 days NP
on the 17th has Salary Due MTD = ₹14,000, so PF at 8% = ₹1,120, growing as they earn. The
alternative (a flat full-month salary regardless of days worked) was explicitly rejected.

This was the last thing blocking the build.

---

## Open decision 5 — portal warning for retroactive shifts (DECIDED, not built)

**Decided: portal warning.** Not a re-score trigger, not "accept it".

**The problem:** entering a `planned_hours` shift after that night's run never re-scores the day —
the nightly only ever writes *today*. Observed for real: `planned_hours/2026-07-09` was created on
07-10, after that night's run had already skipped the day; the admin did the paperwork and it
changed nothing.

Less damaging now that no-plan days default to 10:00–18:00 — but a late-entered **non-standard**
shift (e.g. 12:00–20:00) still never applies, and nothing warns anyone.

**To build:** a warning in the portal when an admin sets or edits a shift for a **past** date,
saying it will not re-score that day and to use Regularization instead. Touches `savePlanned` /
the Attendance page.

---

## What's left

1. **PF/ESI/Imprest** (4) — fully specified now, nothing blocking. Not built.
2. **Portal warning for retroactive shifts** (5) — decided, independent, not built.

Done: the ops flip (1); decisions 2 and 3 confirmed as no-change.

## Things that must not be quietly undone

- **`firebase/functions/attendance-rule-cases.txt` is the source of truth** for the scoring rule.
  Three suites read it (JS / TS / Kotlin). Add cases there. `inputs.file()` in
  `android/app/build.gradle.kts` is load-bearing — without it Gradle reports the test UP-TO-DATE
  and it never re-runs.
- **The backfill's punches-only rule** — it never created Absent/PL/LWP retroactively, so it could
  only ever add days people worked. Any future backfill should keep that shape.
- **`home_out` is terminal**, which is why both the End Day button and logout confirm. A self-serve
  undo window and a biometric gate were both proposed and **explicitly rejected** — don't re-propose;
  upgrade the dialog to slide-to-confirm instead if it proves too easy to tap through.
