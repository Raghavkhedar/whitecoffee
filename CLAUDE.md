# WhiteCoffee Monorepo — Root Context

Two products for Senken Engineering, one Firebase project (`white-coffee-92c27`):

- **`android/`** — Android app (Kotlin, Jetpack Compose, Gradle). Authoritative context: `android/CLAUDE.md`. Build: `cd android && ./gradlew :app:compileDebugKotlin`.
- **`admin/`** — Next.js admin portal. Authoritative context: `admin/CLAUDE.md`. Build: `cd admin && npm run build`.
- **`firebase/`** — SINGLE source of truth for backend: `firestore.rules`, `storage.rules`, `functions/`. Deploy from repo root: `firebase deploy`.

## Rules of the monorepo
- Firestore/Storage rules live ONLY in `firebase/`. Never re-add a `firestore.rules` inside `android/` or `admin/` — that duplication is exactly what this monorepo removed.
- Each side builds independently; there is no shared JS build graph (no Nx/Turborepo).
- Deploy backend from root via the single root `firebase.json`.
