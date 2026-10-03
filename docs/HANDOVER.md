# WhiteCoffee — Handover

Senken Engineering's attendance / payroll / field-ops system. Four codebases, **one Firebase project** (`white-coffee-92c27`). This doc gets you from zero to making a cross-cutting change, using the worked example **"rename attendance status `SCHL` to `xyz`"** (§6).

Authoritative per-area context lives in `CLAUDE.md` (root), `admin/CLAUDE.md`, `android/CLAUDE.md`, `mobile/AGENTS.md`. Read root `CLAUDE.md` first — its rules override defaults.

---

## 1. Map of the repo

| Dir | What | Build / test |
|---|---|---|
| `firebase/` | **Single source of truth for backend**: `firestore.rules`, `storage.rules`, `functions/` (Node, Cloud Functions) | `cd firebase/functions && node --check index.js && npm test`; `npm run lint`; emulator: `npm run test:emulator`; rules: `cd firebase/rules-tests && npm test` (110 tests) |
| `admin/` | Next.js admin portal (HR/payroll/approvals) | `cd admin && npm run build`; lib tests via `npx tsx <file>.test.ts` |
| `android/` | Kotlin / Compose employee app (being replaced by `mobile/`) | `cd android && ./gradlew :app:compileDebugKotlin` |
| `mobile/` | Expo / React Native client, parity target for Android, all four roles | `cd mobile && npx tsc --noEmit && npm test` (needs `mobile/.env`, copy six values from `admin/.env.local`, renamed `EXPO_PUBLIC_FIREBASE_*`) |
| `docs/` | Design docs; `docs/superpowers/specs` + `plans` are per-feature designs | — |

Deploy backend from repo root: `firebase deploy` (may need `firebase login --reauth`). Never put a `firestore.rules` inside `android/`, `admin/` or `mobile/`.

## 2. Standing rules that bite

1. **Rules ARE the security boundary.** Clients use the client SDK; anything rules permit, an employee can do directly. Rules are document-level; a `{path=**}` collection-group rule is a second door. Run `firebase/rules-tests` before and after any rule change.
2. **Roles:** `admin | office | operations | sales`. `sales` is a hybrid — never write `role === 'operations' ? site : office`. Use the role-capabilities table, mirrored in four files that must change together: `admin/src/lib/roleCapabilities.ts`, `firebase/functions/roleCapabilities.js`, `android/…/data/model/RoleCapabilities.kt`, `mobile/src/roles/roleCapabilities.ts`.
3. **Notifications:** no client may write `users/{uid}/notifications`. Whoever creates a `sent_notifications` doc also writes the bell row (admin portal in its batch; server senders via Admin SDK). Don't add it generically in `sendPushNotification`.
4. **Cloud Functions run on UTC.** Compute IST dates by shifting `+05:30` and reading `getUTC*` on a `"yyyy-mm-ddT00:00:00Z"` string. Never bare `new Date()` / `getDay()`.
5. Admin portal and mobile are separate npm projects; install/run each in its own dir.

## 3. Attendance status — data model

Collection: `users/{uid}/attendance_status/{yyyy-mm-dd}` (IST date as doc ID). Written by the nightly function `computeDailyAttendanceStatus`, by admin Regularization approval, and by `scoreRetroactiveLeave`.

Statuses: `Present`, `HalfDay`, `SL`, `LNF` (legacy alias `SLNF`), `Absent`, **`SCHL`** (Scheduled Leave), `USCHL` (Unscheduled Leave), `WO`, `Sunday`, `Holiday`.

- `SCHL` = day inside an **approved** leave, no punches. Always the status `SCHL`; `salaryCredit` field says paid (`1`, drew from `plBalance`) or unpaid (`0`, balance exhausted). `salaryCredit` exists **only** on `SCHL` (and `Holiday`).
- `USCHL` is admin-only (Regularization outcome), never written nightly, carries no `salaryCredit`.
- Legacy `PL`/`LWP` docs were migrated to `SCHL`/`USCHL` on 2026-09-21; none remain.
- The status string is **persisted in Firestore and read by many consumers** — a rename is a data migration, not just a code edit (§6).

## 4. Where `SCHL` lives (complete inventory)

Found via `grep -rn SCHL` across the repo (535 hits / 40 files, mostly tests and docs). Production-code hits:

### Backend — `firebase/functions/`
| File | Role |
|---|---|
| `attendanceRules.js:93-100` | `resolveLeaveStatus` — **creates** the status: returns `{status: "SCHL", salaryCredit: balance>0 ? 1 : 0}` |
| `nightlyScoring.js` | Pure scorer. L30/42/111 doc comments; **L167 `TXN_STATUSES = new Set(["Absent","SCHL"])`** — routes SCHL days to the transactional path (functional string) |
| `nightlyRunner.js` | **L334 `prior.status === "SCHL"`** (functional); other hits are comments (L21,30,50,215,239,278-285,329,338) |
| `retroLeaveScoring.js` | **L114 `existing.status === "SCHL"`** (functional); `updates[].status: "SCHL"` emitted by planner; rest comments |
| `retroLeaveRunner.js` | Log line L110 + comments |
| `dailySpend.js` | **L29 `if (status === "SCHL")`** (functional, weight by `salaryCredit`); L9-11 comments; note SCHL is deliberately absent from the weight map at L20 |
| `payrollDeductions.js` | **L136 `case "SCHL":`** in `tallyAttendanceStatus` (functional); `schlPaid` param/field names L90-99 are identifiers, not the status string |
| `index.js` | L360 comment; **L1601** dashboard sheet column headers `"SCHL (Paid) (×1)"`, `"SCHL (Unpaid) (×0)"` (user-visible export text); L735/1622-1662 variables `schl`, `schlPaid` (identifiers); L2297 comment |
| `scripts/migrateLegacyLeaveStatuses.js` | One-off PL/LWP→SCHL migration; L64/70 write `"SCHL"`, L213 status allow-list. **This is the template for a rename migration** (dry-run default, backup, `--apply`, `--restore`) |
| `scripts/backfillNightlyDate.js` | 1 hit |
| `firestore.rules:437` | Comment only. **Rules contain no `SCHL` string check** |

### Admin portal — `admin/src/`
| File | Role |
|---|---|
| `types/index.ts:96` | `AttendanceStatus` union includes `'SCHL'`; comments L94,103-104 |
| `components/ui.tsx:44` | `STATUS_MAP` badge: key `SCHL` + display `label: 'SCHL'` (colours `#E3EEFB`/`#1A5FAF`) |
| `app/(admin)/attendance/page.tsx` | L262 and L451 `=== 'SCHL' \|\| === 'USCHL'` (leave counts); L613 legend text `'L = SCHL / USCHL'`; L119 comment |
| `app/(admin)/regularization/page.tsx` | Dropdown list `ATTENDANCE_STATUSES` (L15) holds only `USCHL` (admin cannot pick SCHL); L153 comment |
| `lib/leaveCancellation.ts` | **L124 `data.status === 'SCHL'`**, **L130 `... && salaryCredit === 1`** (refund logic) |
| `lib/firestore.ts` | Comments L337-387, L473, L514 (cancel/approve logic); no functional string — verify with grep |
| `lib/cancelLeaveTransaction.ts:8` | Comment |
| `lib/leaveCancellation.test.ts` | 42 hits |

### Android / Mobile
- **No code references `SCHL`.** Android's `AttendanceStatusRecord.status` is a plain `String`; mobile only handles `DayStatus = 'HalfDay'|'SL'|'Present'` for its own regularization UI. `android/CLAUDE.md` L167-186 documents it. Employees see no SCHL-specific logic. A rename needs **no app code change**, only doc updates.

### Docs mentioning it (update for accuracy)
`admin/CLAUDE.md` (≈15 hits, L34, 76-105, 151-157), `android/CLAUDE.md` (L167-186), and the specs/plans under `docs/superpowers/` (historical; leave as-is, they're a record).

### Tests that assert the string (all must be updated)
`firebase/functions/`: `attendanceRules.test.js`, `nightlyScoring.test.js`, `retroLeaveScoring.test.js`, `payrollDeductions.test.js`, `dailySpend.test.js`, `unclosedDay.test.js`, `holidayWiring.test.js`, `scripts/*.test.js`, `emulator-tests/nightlyRunner.emulator.js`, `emulator-tests/retroLeaveRunner.emulator.js`; `firebase/rules-tests/cancel-leave-transaction.test.js`; `admin/src/lib/leaveCancellation.test.ts`.

## 5. Distinguish three kinds of occurrence

Before editing, classify each hit — different handling:
1. **Stored value / functional comparison** (`"SCHL"` literals in the table above marked functional) → must change, and existing Firestore data must be migrated.
2. **User-visible label** (badge label in `ui.tsx`, legend in `attendance/page.tsx`, export headers in `index.js:1601`, `admin` copy). Can be changed independently of the stored value — decide whether you want to rename display only (cheap, no migration) or the stored value too.
3. **Identifiers / comments** (`schlPaid`, `userAttendanceMTD.schl`, `isUnpaidSchl`, comments). Optional cosmetic rename; no behaviour impact. Don't rename `schlPaid` etc. unless you want to — it is internal.

## 6. Worked example: rename `SCHL` → `xyz`

**Decide first:** display-only rename vs. stored-value rename.

### 6A. Display-only rename (no migration, low risk)
Change only: `admin/src/components/ui.tsx:44` (`label`), `admin/src/app/(admin)/attendance/page.tsx:613` legend, and if desired `firebase/functions/index.js:1601` headers (note: the Google Sheet / dashboard export consumers may key on header text — check before changing). Run `cd admin && npm run build`.

### 6B. Stored-value rename (full)
Order matters — **code that reads both values must ship before data is migrated**, else the nightly run and cancel-leave break mid-way.

1. **Phase 1 — tolerant readers (deploy first).** In every functional comparison make the code accept both `"SCHL"` and `"xyz"`:
   - `nightlyScoring.js:167` `TXN_STATUSES`; `nightlyRunner.js:334`; `retroLeaveScoring.js:114`; `dailySpend.js:29`; `payrollDeductions.js:136` (`case "SCHL": case "xyz":`); `admin/src/lib/leaveCancellation.ts:124,130`; `admin/src/components/ui.tsx` (add `xyz` key beside `SCHL`); `admin/src/app/(admin)/attendance/page.tsx:262,451`; `admin/src/types/index.ts:96` union (add `'xyz'`).
   - Deploy functions (`firebase deploy --only functions`) and the admin portal.
2. **Phase 2 — writers.** Change `attendanceRules.js:100` (`status: "xyz"`) and the planner output in `retroLeaveScoring.js` so new docs are written as `xyz`. Update `scripts/migrateLegacyLeaveStatuses.js` L64/70/213 only if it will be re-run (it is one-off and done; leave or update the allow-list).
3. **Phase 3 — migrate data.** Copy `firebase/functions/scripts/migrateLegacyLeaveStatuses.js` to a new script (e.g. `renameSchlStatus.js`): query each user's `attendance_status` where `status == "SCHL"`, patch `status: "xyz"` (preserve `salaryCredit`, `markedBy`; add `migratedFrom: "SCHL"`, `lastModifiedBy: "system:..."` so the audit trigger attributes it), back up first, dry-run default, `--apply`, `--restore`. Mirror its pure `plan…` function + unit test. Note the audit trigger fires on each write — run in batches.
4. **Phase 4 — cleanup.** Remove the `"SCHL"` branch from the tolerant readers; update the tests (§4), `admin/CLAUDE.md`, `android/CLAUDE.md`; optionally rename identifiers (`schlPaid`, etc.).
5. **Not needed:** `firestore.rules` (no SCHL string), Android, mobile, capability tables.

### Validation checklist (run all before pushing)
```bash
cd firebase/functions && node --check index.js && npm test && npm run lint
cd firebase/functions && npm run test:emulator        # needs firebase CLI + emulator
cd firebase/rules-tests && npm test                   # 110 tests; run if rules touched
cd admin && npx tsx src/lib/leaveCancellation.test.ts && npm run build
cd android && ./gradlew :app:compileDebugKotlin       # only if Kotlin touched
cd mobile && npx tsc --noEmit && npm test             # only if mobile touched
grep -rn "SCHL" firebase admin/src android mobile/src --exclude-dir=node_modules  # confirm only intentional leftovers
```
Pay-impact sanity: the pay-neutrality invariant must hold — `dayWeight` (`dailySpend.js`) and `computeDaysNP` / `tallyAttendanceStatus` (`payrollDeductions.js`) must give identical numbers for an `xyz` doc as the old `SCHL` doc with the same `salaryCredit`. `payrollDeductions.test.js` and `dailySpend.test.js` cover this; add `xyz` cases.

## 7. Related behaviour to know
- **PL balance (`plBalance`)**: +1 on the 1st of the month (`accrueMonthlyLeave`); −1 per paid SCHL day; USCHL and unpaid SCHL never decrement. Cancel-leave refunds only days with `salaryCredit === 1`.
- **Nightly flow:** `runNightlyScoring` (`nightlyRunner.js`) → pure `nightlyScoring.js`; Absent/SCHL users go through per-user Firestore transactions so approving a leave mid-run can't race.
- **Retro leave:** `scoreRetroactiveLeave` trigger (`retroLeaveRunner.js` + `retroLeaveScoring.js`) scores past days of a late-approved leave; cancel-leave (`admin/src/lib/cancelLeaveTransaction.ts`) is a single transaction that cannot race it.
- **Days NP formula** (`computeDaysNP`): `present + SL×0.75 + halfDay×0.5 + LNF×0.5 + Σ(salaryCredit over SCHL) + holiday×1 − absent×2`.
- **Design history:** `docs/superpowers/specs/2026-09-18-schl-uschl-leave-status-design.md`, `…2026-09-19-legacy-leave-status-migration-design.md` (the migration pattern), `…2026-09-21-transactional-nightly-and-cancel-design.md`.
