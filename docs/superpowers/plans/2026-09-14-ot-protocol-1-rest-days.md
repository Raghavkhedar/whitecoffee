# Implementation Plan — OT Protocol 1: immutable rest days

**Spec:** `docs/superpowers/specs/2026-09-14-ot-redesign-design.md` (Protocol 1 section).
The spec is the authority; this plan is its argument.

## Global Constraints

- **Three-sided mirror.** `admin/src/lib/otLedger.ts` and `firebase/functions/otLedger.js` are
  hand-kept ports of each other, as are `otAggregate.ts` / `otAggregate.js`. Any change to one
  MUST land in the other in the same task, with matching tests. There is no shared JS build graph.
- **Deprecate, never delete, persisted fields.** `PlannedHours.otAuthorized` and
  `Settlement.restDayOtMins` stay in the TypeScript types marked `@deprecated`, because historical
  Firestore documents carry real values. Only the *in-memory* ledger types
  (`DayLedgerInput.otAuthorized`, `DayLedger.restDayOtMins`, `DayLedger.unauthorizedRestDay`)
  are removed outright.
- **One definition of "rest day".** Use `resolveRestDayType(dateStr, isHoliday)` from
  `firebase/functions/attendanceRules.js` on the functions side. Do not re-derive
  `getUTCDay() === 0` in new code.
- **No live Firestore testing.** Correctness is established by unit tests plus the rules
  emulator suite. Never write to production.
- **Verification commands.**
  - admin: `cd admin && npx tsx src/lib/otLedger.test.ts && npx tsx src/lib/otAggregate.test.ts && npm run build`
  - functions: `cd firebase/functions && node --check index.js && npm test` (eslint is stale — do NOT run lint)
  - rules: `cd firebase/rules-tests && npm test` (72 tests today; run before and after)
- **Commit per task**, message ending with the attribution lines used elsewhere in this repo.

## Task 1 — Core per-day math

**Files:** `admin/src/lib/otLedger.ts`, `firebase/functions/otLedger.js`,
`admin/src/lib/otLedger.test.ts`, `firebase/functions/otLedger.test.js`

1. Remove `otAuthorized` from `DayLedgerInput`.
2. Remove `restDayOtMins` and `unauthorizedRestDay` from `DayLedger` and from `ZERO`.
3. Replace the rest-day branch with, verbatim:
   ```
   if (isRestDay) return { ...ZERO, pendingExtraMins: worked };
   ```
   Rest-day work is pending OT for the whole worked window — never auto-credited, never shortage.
4. Remove `restDayOtMins` from `NetLedgerParts` and from `netLedgerMins`, leaving
   `net = (autoOtMins + approvedGrantedMins) - shortageMins - woDebitMins`.
5. Rewrite the comment block above `computeDayLedger` so it describes the new rest-day rule.
   Do not leave prose describing authorization.
6. **Tests.** Delete the authorized/unauthorized rest-day cases and replace them with:
   - a rest day with a worked window yields `pendingExtraMins === worked`, and zero for every
     other field;
   - a rest day never yields shortage, whatever the in/out times;
   - the declared-OT ceiling does NOT apply on a rest day (all of it is pending regardless of
     `declaredOtMins`);
   - `netLedgerMins` excludes pending minutes entirely.
   Weekday cases must keep passing untouched — do not modify them.

## Task 2 — Range aggregation

**Files:** `admin/src/lib/otAggregate.ts`, `firebase/functions/otAggregate.js`,
`admin/src/lib/otAggregate.test.ts`, `firebase/functions/otAggregate.test.js`

1. Delete the `otAuthByDate` set and every read of `p.otAuthorized` in both
   `computeRangeLedger` and `dailyOtWoCash`.
2. Stop returning `restDayOtMins` and `unauthorizedRestDates` from `computeRangeLedger`.
   Rest-day pending minutes join `pendingOtMins` / `pendingDates` through the existing
   "has pending minutes and no `ot_approvals` doc" path — confirm that path already covers
   them and add nothing new if it does.
3. Drop `restDayOtMins` from the `netLedgerMins(...)` call and from `dailyOtWoCash`'s per-date
   net.
4. **Tests.** Add: a rest day with punches and no approval contributes 0 to `netMins` and
   appears in `pendingDates`; a rest day with a partial approval contributes exactly the
   approved minutes; `dailyOtWoCash` for a rest-day date equals the approved minutes' cash and
   is 0 when unapproved. Assert the existing invariant still holds — the sum of `dailyOtWoCash`
   over a month equals `settlementCash(rate, woDays, netMins)`.

## Task 3 — Write guards and security rules

**Files:** `admin/src/lib/firestore.ts`, `firebase/firestore.rules`, `firebase/rules-tests/`

1. Delete `setOtAuthorization` entirely.
2. Add a rest-day guard to `setAttendanceStatus` and `markWo` in `firestore.ts`: throw a clear
   Error before issuing any write when the target date is a Sunday or a holiday. The helper
   needs the holiday set; pass it from the caller rather than reading Firestore inside the
   helper. Mirror `resolveRestDayType`'s precedence.
3. In `firestore.rules`, add the two helpers from the spec (`isSundayDate`, `isRestDate`) beside
   the other date helpers, and add `&& !isRestDate(date)` to `allow write` on
   `/users/{userId}/attendance_status/{date}`. Leave the collection-group read rule alone.
4. **Tests** (`firebase/rules-tests`): WO on a Sunday denied; WO on a holiday denied; `Present`
   on a Sunday denied; any status on a plain Monday still allowed; a non-admin manager holding
   `/attendance` denied on a rest day and allowed on a weekday. Run the whole suite before and
   after — it has caught a real regression before.

## Task 4 — Admin portal UI

**Files:** `admin/src/app/(admin)/attendance/page.tsx`,
`admin/src/app/(admin)/ot-shortage/page.tsx`,
`admin/src/app/(admin)/regularization/page.tsx`,
`admin/src/app/(admin)/ot-settlements/page.tsx`,
`admin/src/app/(admin)/working-hours-shortage-excess/page.tsx`,
`admin/src/types/index.ts`, `admin/src/lib/auditEntry.ts`

1. **Attendance page:** remove the "Authorize OT" toggle and its `setOtAuthorization` call.
   A rest-day cell renders its `Sunday`/`Holiday` badge with no WO control and no status control.
2. **OT & Shortage page:** delete the unauthorized-rest-day warning section and the
   `restDayOtMins` column/card. Rest days appear in the ordinary pending queue, labelled
   `Sunday`/`Holiday`, with the full worked window as the requested amount, approvable for a
   partial figure through the existing approve dialog.
3. **Regularization page:** `WO` must not be offered as an outcome when the request's date is a
   rest day, and the approval path must re-check rather than trust the submitted form.
4. **Settlements + Working Hours pages:** fold the rest-day OT column into granted OT.
5. **Types:** mark `PlannedHours.otAuthorized` and `Settlement.restDayOtMins` `@deprecated` with
   a one-line reason pointing at the spec. New settlement writes set `restDayOtMins: 0`.
6. **auditEntry.ts:** drop `otAuthorized` from the field-label map only if it becomes unreachable;
   keep it if historical audit entries can still render it.
7. Verify with `npm run build` — there must be no unused-import or type errors left behind.

## Task 6 — Fix: pending tracked by remaining amount, not by date presence

**Spec:** the "Protocol 1 fix" addendum appended to `docs/superpowers/specs/2026-09-14-ot-redesign-design.md`
after Protocol 1, found by the final whole-branch review (finding F2). Read it — it has the
exact failure scenario and the exact formula.

**Files:** `admin/src/lib/otAggregate.ts`, `firebase/functions/otAggregate.js`,
`firebase/functions/index.js` (the OT Exception tab's inline pending derivation), plus their
test files.

1. In `computeRangeLedger`'s `accrueDay` (both `.ts` and `.js`), replace the
   `led.pendingExtraMins > 0 && !apprByDate.has(date)` gate with a remaining-amount computation:
   `remaining = Math.max(0, led.pendingExtraMins - (apprByDate.get(date)?.requestedMins ?? 0))`.
   Accrue `remaining` into `pendingOtMins` and push the date into `pendingDates` when
   `remaining > 0` — not when `pendingExtraMins > 0`.
2. Apply the identical fix to `dailyOtWoCash`'s equivalent per-date pending logic if it derives
   a pending figure there too (check; it may only need `netMins`, which is unaffected — granted
   OT is still `Σ approvedMins` regardless of this change).
3. In `index.js`, find the OT Exception tab's own "has a decision doc for this date" check
   (search near where `otRowFor` resolves `Pending` vs `APPROVED`/`NOT APPROVED`) and apply the
   same remaining-amount logic, so the sheet and the portal agree.
4. **Tests.** Add: a date with `pendingExtraMins = 600` and an approval doc with
   `requestedMins = 60` still reports `remaining = 540` as pending. A date with an approval doc
   whose `requestedMins` matches or exceeds `pendingExtraMins` reports 0 remaining (this must
   cover the ordinary approve/reject case — verify it is unaffected). A rejected day
   (`approvedMins = 0`, `requestedMins` = the original ask) still nets 0 grantedOT and is
   correctly NOT pending once `requestedMins` covers the amount. Confirm the invariant
   `sum(dailyOtWoCash) === settlementCash(...)` still holds — this task must not change
   `netMins`/`grantedOtMins`, only the pending derivation.

**Verify:**
- `cd admin && npx tsx src/lib/otAggregate.test.ts && npm run build`
- `cd firebase/functions && node --check index.js && node --check otAggregate.js && npm test`

## Task 5 — Cloud Functions OT Exception tab

**Files:** `firebase/functions/index.js`

1. The three `restDay` branches (near lines 997, 1107, 1303 on `main`) stop reading
   `otAuthorized`. A rest day with work reports as **pending** when no `ot_approvals` doc
   exists, and as the decided amount when one does.
2. Remove the `unauthorizedRestDay` handling and any "unauthorized" wording from the sheet.
3. Section 8b (`computeRangeLedger` + `settlementCash`) needs no logic change, but confirm it
   still compiles against Task 2's changed return shape.
4. Verify with `node --check index.js && npm test`.
