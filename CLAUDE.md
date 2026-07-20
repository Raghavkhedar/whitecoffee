# WhiteCoffee Monorepo — Root Context

Two products for Senken Engineering, one Firebase project (`white-coffee-92c27`):

- **`android/`** — Android app (Kotlin, Jetpack Compose, Gradle). Authoritative context: `android/CLAUDE.md`. Build: `cd android && ./gradlew :app:compileDebugKotlin`.
- **`admin/`** — Next.js admin portal. Authoritative context: `admin/CLAUDE.md`. Build: `cd admin && npm run build`.
- **`firebase/`** — SINGLE source of truth for backend: `firestore.rules`, `storage.rules`, `functions/`. Deploy from repo root: `firebase deploy` (may need `firebase login --reauth` if the CLI token expired). Functions have a `npm test` (`node --test`, no deps) boundary suite in `firebase/functions/`; the eslint config is stale (parse-errors on modern JS like `?.`), so validate with `node --check` + `npm test`, not `lint`. Cloud functions run on a **UTC** clock — compute IST dates by shifting `+05:30` and reading `getUTC*` / `getUTCDay()` on a `"yyyy-mm-ddT00:00:00Z"` string; never use bare `new Date()`/`getDay()` for an IST date.

## Security boundary — read before touching `firestore.rules`
Both clients use the **client Firebase SDK**, so `firebase/firestore.rules` is not one
layer of defence among several — **it is the defence**. Anything the rules permit, an
employee can do directly against the API with their own login, bypassing both apps.
It has an emulator test suite: `cd firebase/rules-tests && npm test` (63 tests). Run it
before and after ANY rule change — it has already caught a real regression.
Two traps it exists to catch:
- **Rules are DOCUMENT-level.** No field-level read control: if a rule lets you read a
  doc you read every field. That is why pay lives in `users/{uid}/compensation/current`.
- **A `{path=**}` collection-group rule is a second door.** Tightening a per-doc rule
  does nothing if a collection-group rule still grants the write — `attendance_status`
  did exactly this and silently reopened a self-approval hole.
Full audit, rationale, and deployment runbook: `docs/security-hardening-2026-07-20.md`.

## Rules of the monorepo
- Firestore/Storage rules live ONLY in `firebase/`. Never re-add a `firestore.rules` inside `android/` or `admin/` — that duplication is exactly what this monorepo removed.
- Each side builds independently; there is no shared JS build graph (no Nx/Turborepo).
- Deploy backend from root via the single root `firebase.json`.

## Roles — read before touching any `role` check
Four roles live on `users/{uid}.role`: `admin` | `office` | `operations` | `sales`. **`sales` is a
deliberate hybrid** (office-style fixed 10:00–18:00 status window, ops-style hybrid check-ins and
conveyance; no OT/shortage/WO/categories/manpower), so it rides **neither** side of the historical
binary `isOps = role === 'operations' ? (site) : (office)` — that pattern drops sales into the
office branch **silently**, which is a payroll bug, not a cosmetic one.

Route role decisions through the **role-capabilities table**, mirrored on all three sides (there is
no shared JS build graph) and unit-tested on each — **change all three together**:
- `admin/src/lib/roleCapabilities.ts` (+ `.test.ts`, `npx tsx`)
- `firebase/functions/roleCapabilities.js` (+ `.test.js`, `npm test`)
- `android/…/data/model/RoleCapabilities.kt`

Axes: `attendanceInTypes` · `attendanceOutTypes` · `usesFixedWindow` · `usesOtShortageLedger` ·
`tracksShortage` · `usesConveyance` · `getsCategories` · `inManpowerReports`. Note `tracksShortage`
is **separate** from `usesOtShortageLedger`: office/admin show shortage while running no ledger.
Only `admin` is role-gated in Firestore rules; everything else is per-tab `tabAccess`.
Design: `docs/superpowers/specs/2026-07-16-sales-role-design.md`
