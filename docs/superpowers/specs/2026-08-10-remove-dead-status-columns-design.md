# Remove the dead Status columns from the submission exports

**Date:** 2026-08-10
**Scope:** `firebase/functions/index.js` — `exportToSheets` only
**Status:** design approved, not yet implemented

---

## Problem

Five of the eleven tabs `exportToSheets` writes carry a `Status` column that no
longer means anything:

| Tab | Spreadsheet const | Firestore collection |
|---|---|---|
| MT Requests | `SHEET_ID_3` | `material_requests` |
| MT Purchases | `SHEET_ID_4` | `material_purchases` |
| Material Transfers | `SHEET_ID_5` | `material_transfers` |
| Tool Transfers | `SHEET_ID_6` | `tool_transfers` |
| Work Progress | `SHEET_ID_7` | `work_progress` |

Each row reads `d.status || ""`. **Nothing writes `d.status` on any of these five
collections.** The Android models — `MaterialToolRequest.kt`, `MaterialToolPurchase.kt`,
`Transfer.kt` (shared by both transfer types) and `WorkProgress.kt` — have no `status`
field at all, and the portal's `/submissions` editor does not expose one either
(`EDITABLE_FIELDS` has no `status` key).

The column is not merely blank, it is **legacy and actively misleading**. Reading the
live sheets on 2026-08-10 found three rows from June 2026 still showing `pending`
(two MT Requests/Purchases rows for EMP0012, one Work Progress row). An earlier app
version wrote a status; the field was later dropped from the models; the export kept
reading it. The result is that three old submissions appear permanently "pending"
while identical newer ones show nothing — a distinction that reflects app history,
not anything about the work.

Being in **column B** on four of the five tabs, it also splits `Submitted At` from
the employee identity columns for no reason.

## Decision

Remove the `Status` column from those five tabs. Nothing else changes.

**Explicitly out of scope:**

- **Leave Requests → `Status`** stays. It is genuinely populated (`pending` /
  `approved` / `rejected`), written by `LeaveRequest.kt:56` and updated by the approval
  flow. It is approver-set workflow state, not a form field — and it is the only place
  in the export that shows whether a leave was granted.
- **Attendance → `Daily Status`** stays. It is the computed payroll status
  (Present / Absent / PL), unrelated to form submissions.
- **The legacy `status` fields in Firestore stay.** Three documents carry one. No code
  reads them once this change lands, and they are the only surviving record that those
  submissions were once marked pending. Writing a migration script to delete three unread
  fields from live production costs more risk than it removes.
- **No test harness for `exportToSheets`.** Asserting header shape would mean extracting
  all eleven header definitions into a testable module. That is a worthwhile refactor
  (it is roadmap finding H4, "`exportToSheets` is 920 lines with one `try` block") but it
  is a different change and should not ride along on a ten-line edit.

## Why deleting the column is safe

`writeTab` (`index.js:207`) calls `spreadsheets.values.clear()` across the whole tab
before writing:

```js
await ensureTab(sheets, spreadsheetId, tabName);
await sheets.spreadsheets.values.clear({ spreadsheetId, range: tabName });
```

So a narrower grid leaves no stale trailing column — the old last column is cleared, not
orphaned.

All five spreadsheets were inspected on 2026-08-10. Each is a **single-tab file
containing only the exported grid**: no second tab, no summary block, no derived
columns, nothing referencing the export by column letter. Shifting columns left breaks
no downstream consumer.

## Change

Five blocks, two deletions each — one from the header array, one from the row array.

| Block | Lines | Edit |
|---|---|---|
| MT Requests | 1220–1230 | drop `"Status"` from `header`; drop `d.status \|\| ""` from `base` |
| MT Purchases | 1242–1253 | drop `"Status"` from `header`; drop `d.status \|\| ""` from `base` |
| Material Transfers | 1265–1276 | drop `"Status"` from `header`; drop `d.status \|\| ""` from `base` |
| Tool Transfers | 1288–1298 | drop `"Status"` from `header`; drop `d.status \|\| ""` from `base` |
| Work Progress | 1310–1314 | drop `"Status"` from `header`; drop `d.status \|\| ""` from the row |

In the first four tabs `base` is spread into every row (`[...base, ...]`), so removing
one element from `base` shifts the whole row consistently — the item columns that follow
need no edit. Work Progress builds its row inline and loses its 8th element, between
`Work Description` and `Submitted At`.

The `rows.sort((a, b) => a[0].localeCompare(b[0]))` calls are unaffected: they sort on
column A, which is `Submitted At` (or `Date` for Work Progress) in every case, and
column A is not the column being removed.

### Resulting headers

```
MT Requests         Submitted At | Employee Name | Employee ID | Site ID | Site Name |
                    Item Name | Quantity | Unit | Item Notes | Overall Notes | Photo URLs

MT Purchases        Submitted At | Employee Name | Employee ID | Site ID | Site Name |
                    Item Name | Quantity | Unit | Price Per Unit | Total Price |
                    Grand Total | Notes | Photo URLs

Material Transfers  Submitted At | Employee Name | Employee ID | Transfer Date | From |
                    To | Transferred By | Received By | Item Name | Quantity | Unit |
                    Condition | Notes | Photo URLs

Tool Transfers      Submitted At | Employee Name | Employee ID | Transfer Date | From |
                    To | Transferred By | Received By | Item Name | Quantity | Unit |
                    Condition | Notes

Work Progress       Date | Employee Name | Employee ID | Site ID | Site Name |
                    Hours Worked | Work Description | Submitted At | Photo URLs
```

## Verification

- `node --check index.js` — the functions eslint config is stale and parse-errors on
  modern JS, so `node --check` plus the boundary suite is the validation path, not `lint`
  (see root `CLAUDE.md`).
- `npm test` in `firebase/functions` — the boundary suite does not cover `exportToSheets`,
  so this proves no collateral breakage rather than proving the change itself.
- The real proof is the sheets after the next nightly run: five tabs one column narrower,
  headers as listed above, and the three legacy `pending` values gone from view.

## Rollout

`firebase deploy --only functions:exportToSheets` from the repo root. Requires a valid
CLI session — `firebase login --reauth` must be run in a real terminal, never from a
Claude Code session.

No Android release is needed; no client reads these sheets. The export is nightly, so the
sheets change on the next scheduled run rather than at deploy time. `exportToSheets` is a
single monolithic function with no retry, so if that night's run fails for an unrelated
reason the columns simply update the following night.
