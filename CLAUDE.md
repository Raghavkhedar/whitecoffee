# WhiteCoffee Monorepo — Root Context

Two products for Senken Engineering, one Firebase project (`white-coffee-92c27`):

- **`android/`** — Android app (Kotlin, Jetpack Compose, Gradle). Authoritative context: `android/CLAUDE.md`. Build: `cd android && ./gradlew :app:compileDebugKotlin`.
- **`admin/`** — Next.js admin portal. Authoritative context: `admin/CLAUDE.md`. Build: `cd admin && npm run build`.
- **`firebase/`** — SINGLE source of truth for backend: `firestore.rules`, `storage.rules`, `functions/`. Deploy from repo root: `firebase deploy` (may need `firebase login --reauth` if the CLI token expired). Functions have a `npm test` (`node --test`, no deps) boundary suite in `firebase/functions/`; the eslint config is stale (parse-errors on modern JS like `?.`), so validate with `node --check` + `npm test`, not `lint`. Cloud functions run on a **UTC** clock — compute IST dates by shifting `+05:30` and reading `getUTC*` / `getUTCDay()` on a `"yyyy-mm-ddT00:00:00Z"` string; never use bare `new Date()`/`getDay()` for an IST date.

## Rules of the monorepo
- Firestore/Storage rules live ONLY in `firebase/`. Never re-add a `firestore.rules` inside `android/` or `admin/` — that duplication is exactly what this monorepo removed.
- Each side builds independently; there is no shared JS build graph (no Nx/Turborepo).
- Deploy backend from root via the single root `firebase.json`.
