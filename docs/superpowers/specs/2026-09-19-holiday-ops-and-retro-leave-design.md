# Holiday pay for operations, past-date holiday guard, late-approved leave — Design

**Date:** 2026-09-19
**Status:** Approved by the requester in chat, pending implementation
**Builds on:** `2026-09-18-schl-uschl-leave-status-design.md`, `2026-09-12-sunday-holiday-status-design.md`

## Decisions the requester made

1. **A Holiday dated on a Sunday pays nothing.** Already true (the Sheets month-to-date loop skips Sundays before it reaches the Holiday case). No change.
2. **Operations staff who work a holiday get only OT, not the +1 holiday day as well.** All work on a Sunday/holiday is *already* raised as pending OT for an admin to approve, with no authorization gate (`computeDayLedger`: `if (isRestDay || isWoDay) return { ...ZERO, pendingExtraMins: worked }`, in `admin/src/lib/otLedger.ts` and its port `firebase/functions/otLedger.js`). So no OT change is needed. The `otAuthorized` gate described in `admin/CLAUDE.md` ("Rest-day OT") is stale.
3. **Office/admin/sales do not work on holidays.** No rule needed; they keep the +1.
4. **Marking or un-marking a holiday for a PAST date is blocked.** The day is already scored; the admin is pointed at Regularization.
5. **Leave approved after its days have passed must be scored in this change** (it stays Absent −2 today, and Regularization cannot make paid leave).

## Design

### A. Holiday `salaryCredit` (operations who worked)

The nightly rest-day branch writes the `Holiday` doc with a `salaryCredit`:

- `0` for a user whose role runs the OT ledger (`usesOtShortageLedger`, i.e. operations) **and** who has a complete in/out pair with worked minutes > 0 that day — their pay for the day is whatever OT the admin approves.
- `1` for everyone else.

Readers treat **only a strict `0`** as "+1 withdrawn"; a legacy `Holiday` doc with no `salaryCredit` is paid, exactly as today. Applied in the month-to-date tally (`tallyAttendanceStatus`) and the Daily Spend Snapshot (`dayWeight`) — the two mirrors of the Days-NP weights.

Judgement calls (rulings): the +1 is withdrawn only when the ledger *would raise pending OT* (worked minutes > 0), so an employee who forgot to check out (one-sided punches → nothing to approve) or who punched in and out inside the same minute keeps the +1. A holiday worked for an admin-approved 0 minutes therefore pays nothing — that is the consequence of "only the OT".

Reconciliation at read time: the +1 is withdrawn when EITHER the nightly wrote `salaryCredit: 0` (punch-based) OR approved OT minutes > 0 exist for that user+date. The second condition is applied by the readers through `effectiveHolidayCredit` (`holidayCredit.js`), because the credit frozen at 23:59 can go stale: a holiday worked with a missed checkout keeps `salaryCredit: 1`, and a later manual-OT grant (`setManualOt`) would otherwise pay the day twice (+1 and the OT). The withdrawal applies only to roles that run the OT ledger (operations); for everyone else the stored credit stands. An approval doc with no `status` field counts as approved — only `status === "rejected"` is excluded.

### B. Past-date holiday guard

`setHoliday` / `deleteHoliday` (admin/src/lib/firestore.ts) refuse any date before today (IST) with a message pointing at Regularization; the Attendance page hides the holiday editor for past dates. This is an admin safety guard, not a security boundary, so `firestore.rules` is untouched.

### C. Late-approved leave

A new Cloud Function trigger `scoreRetroactiveLeave` on `users/{userId}/leave_requests/{requestId}` (any write whose after-state is `approved`). For every granted date strictly before today (IST) whose existing `attendance_status` doc is `Absent` with `markedBy: 'auto'`, it rewrites the day to `SCHL` with `salaryCredit` from a running `plBalance` and decrements `plBalance` by the paid days — all in one transaction. It never touches: days with punches (Present/HalfDay/SL/LNF), admin-marked docs, `Sunday`/`Holiday` docs, dates with no doc, cancelled or ungranted dates. It is idempotent (a re-fire finds no `Absent`+`auto` docs).

Why a Cloud Function and not the portal: writing `plBalance` on the user doc is admin-only in `firestore.rules`, and status writes are tab-gated, so a client-side version would fail for a non-admin Leaves manager or need the rules widened (a security-boundary change). The Admin SDK bypasses rules and needs no change. The cancel path stays consistent because `cancelLeave` writes the reverted `Absent` with `markedBy: 'admin'`, which the trigger skips.

## Not covered / known limits

- The trigger's I/O wrapper (extracted to `firebase/functions/retroLeaveRunner.js`) is now covered by a Firestore-emulator suite, `npm run test:emulator` in `firebase/functions` (`emulator-tests/retroLeaveRunner.emulator.js`: scoring, idempotency, stale-event re-read, refusals, concurrent runs, error re-throw); the decision logic is also a pure, unit-tested function.
- Holiday docs already written before deploy have no `salaryCredit` and will start paying +1 in the current month's live Sheets block (that is the requested Holiday = 1). Frozen past months are unchanged.
