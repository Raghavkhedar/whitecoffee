# WhiteCoffee — Field Operations Management

Attendance, payroll, and field-operations management for **Senken Engineering**, built as a
single monorepo around one Firebase project (`white-coffee-92c27`).

Two products share one backend:

| Product | Who uses it | Stack |
|---|---|---|
| **Android app** (`android/`) | Field operations & office staff — check in/out, leave, material/tool requests, work progress | Kotlin · Jetpack Compose · Gradle · Firebase SDK |
| **Admin portal** (`admin/`) | Admins & tagged managers — attendance, OT/shortage, settlements, payroll, employee management | Next.js 14 (static export) · TypeScript · Tailwind · Firebase Web SDK |
| **Backend** (`firebase/`) | Both of the above | Cloud Functions (Node 24) · Firestore & Storage security rules |

> **New here?** Read this file top-to-bottom, then follow [`REQUIREMENTS.md`](./REQUIREMENTS.md)
> to install the toolchain and obtain the config files you need. After that, the
> **Getting started** sections below get each part running.

---

## Table of contents

- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
  - [1. Clone](#1-clone)
  - [2. Admin portal](#2-admin-portal-admin)
  - [3. Backend — rules & functions](#3-backend--rules--functions-firebase)
  - [4. Android app](#4-android-app-android)
- [Configuration & secrets](#configuration--secrets)
- [Building & running](#building--running)
- [Testing](#testing)
- [Deploying](#deploying)
- [Project conventions](#project-conventions)
- [Troubleshooting](#troubleshooting)
- [Further documentation](#further-documentation)

---

## Architecture

Everything talks to **one** Firebase project. There is no separate API server — the app and
the portal read/write Firestore directly, gated by security rules, and scheduled/ callable
**Cloud Functions** do the server-side work (nightly attendance computation, Google Sheets
export, payroll helpers, push notifications).

```
        ┌──────────────────────┐          ┌──────────────────────┐
        │   Android app        │          │   Admin portal       │
        │  (Kotlin/Compose)    │          │  (Next.js static)    │
        │  field & office staff│          │  admins & managers   │
        └──────────┬───────────┘          └──────────┬───────────┘
                   │  Firebase SDK  (auth + Firestore + Storage)  │
                   └───────────────┬──────────────────────────────┘
                                   ▼
                 ┌─────────────────────────────────────┐
                 │      Firebase project                │
                 │      white-coffee-92c27              │
                 │                                      │
                 │  • Firestore  (data + rules)         │
                 │  • Storage    (photos + rules)       │
                 │  • Auth       (email/password)       │
                 │  • Cloud Functions (Node 24)         │
                 │      – nightly attendance compute    │
                 │      – Google Sheets export          │
                 │      – payroll / leave accrual       │
                 │      – push notifications            │
                 │  • Hosting → admin/out (the portal)  │
                 └─────────────────────────────────────┘
```

**Single source of truth for the backend lives in `firebase/`** — Firestore rules, Storage
rules, and all Cloud Functions. Never duplicate `firestore.rules` inside `android/` or
`admin/`; the monorepo deliberately removed that duplication.

---

## Repository layout

```
whitecoffee/
├── README.md              ← you are here
├── REQUIREMENTS.md        ← toolchain versions + config files to provide
├── CLAUDE.md              ← monorepo rules (agent + human context)
├── firebase.json          ← single deploy config (rules, functions, hosting)
├── .firebaserc            ← default project → white-coffee-92c27
│
├── admin/                 ← Next.js admin portal
│   ├── src/               ← app routes, components, lib (firestore.ts, otLedger.ts, …)
│   ├── .env.local         ← Firebase web config (NOT committed — see .env.local.example)
│   ├── package.json       ← dev / build / deploy scripts
│   └── CLAUDE.md           ← portal-specific architecture & conventions
│
├── android/               ← Kotlin / Jetpack Compose app
│   ├── app/               ← application module (build.gradle.kts, src/, google-services.json)
│   ├── keystore/          ← release signing material (keystore.properties is NOT committed)
│   ├── gradle/            ← version catalog (libs.versions.toml) + wrapper
│   ├── README.md          ← Android-specific setup & build notes
│   └── CLAUDE.md           ← detailed Android architecture
│
└── firebase/              ← the ONLY home of backend code
    ├── firestore.rules    ← Firestore security rules
    ├── storage.rules      ← Storage security rules
    └── functions/         ← Cloud Functions (index.js, npm test boundary suite)
```

---

## Prerequisites

Full versions and install links are in **[`REQUIREMENTS.md`](./REQUIREMENTS.md)**. In short you
need:

- **Node.js** — v20+ for the admin portal; **v24** to run/deploy Cloud Functions (their
  `engines.node` is pinned to 24).
- **npm** (ships with Node).
- **Firebase CLI** (`npm i -g firebase-tools`) — logged in with access to `white-coffee-92c27`.
- **JDK 17** + **Android Studio** (Android SDK, API 35) — only if you work on the Android app.
- The **config/secret files** listed in [Configuration & secrets](#configuration--secrets) —
  these are gitignored, so you must obtain them from a maintainer.

You only need the toolchain for the part(s) you're touching — e.g. front-end contributors can
skip the JDK/Android SDK entirely.

---

## Getting started

### 1. Clone

```bash
git clone <repo-url> whitecoffee
cd whitecoffee
```

### 2. Admin portal (`admin/`)

```bash
cd admin
cp .env.local.example .env.local     # then fill in the real Firebase web config
npm install
npm run dev                          # http://localhost:3000
```

Sign in with an **admin** account (or a user carrying a portal access **tag**). Without a
valid `.env.local` the app builds but cannot reach Firebase.

### 3. Backend — rules & functions (`firebase/`)

Deployed from the **repo root** via the single `firebase.json`.

```bash
# from repo root
firebase login                       # one-time; use --reauth if the token expired

# Cloud Functions dependencies + local test suite
cd firebase/functions
npm install
npm test                             # node --test boundary suite (no external deps)
```

> The functions eslint config is stale (it parse-errors on modern JS like `?.`). **Validate
> with `node --check index.js` + `npm test`, not `npm run lint`.**

### 4. Android app (`android/`)

Open `android/` in Android Studio (it generates `local.properties` with your SDK path), or
build from the CLI:

```bash
cd android
./gradlew :app:compileDebugKotlin    # fast compile check
./gradlew :app:assembleDebug         # build a debug APK
```

`app/google-services.json` is present in the repo. Release builds additionally need
`keystore.properties` and the signing keystore (see below).

---

## Configuration & secrets

None of these are committed (they're in `.gitignore`). Get them from a maintainer and place
them exactly as shown. Templates live alongside the real files where possible.

| File | For | How to obtain |
|---|---|---|
| `admin/.env.local` | Admin portal Firebase web config | Copy `admin/.env.local.example`; fill values from Firebase Console → Project settings → *Your apps* (Web). See [`REQUIREMENTS.md`](./REQUIREMENTS.md). |
| `android/app/google-services.json` | Android Firebase config | Committed already; if regenerating, download from Firebase Console → Android app. |
| `android/local.properties` | Android SDK path (`sdk.dir=…`) | Auto-generated by Android Studio; or create it manually. |
| `android/keystore.properties` | **Release** signing (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`) | From a maintainer — only needed for signed release builds. |
| Cloud Functions **secrets** | `exportToSheets` Sheets service account + Maps | Set in Secret Manager, not a file: `firebase functions:secrets:set ATTENDANCE_SHEETS_KEY` and `… MAPS_API_KEY`. |

**Cloud Functions run on a UTC clock.** IST dates are computed by shifting `+05:30` and reading
`getUTC*`; never use a bare `new Date()`/`getDay()` for an IST date. The Google Sheets export
targets sheet IDs hard-coded in `firebase/functions/index.js`.

---

## Building & running

| Task | Command | Where |
|---|---|---|
| Admin dev server | `npm run dev` | `admin/` |
| Admin production build (static export → `out/`) | `npm run build` | `admin/` |
| Android debug compile | `./gradlew :app:compileDebugKotlin` | `android/` |
| Android debug APK | `./gradlew :app:assembleDebug` | `android/` |
| Android signed release | `./gradlew :app:assembleRelease` | `android/` (needs keystore) |
| Cloud Functions local shell | `npm run shell` | `firebase/functions/` |

The admin portal uses `output: 'export'` — `next start` is unused; builds produce static HTML
in `admin/out/` which Firebase Hosting serves.

---

## Testing

- **Admin pure logic** (OT/shortage ledger, portal access): standalone scripts run with tsx.
  ```bash
  cd admin
  npx tsx src/lib/otLedger.test.ts
  npx tsx src/lib/otAggregate.test.ts
  npx tsx src/lib/portalAccess.test.ts
  ```
- **Cloud Functions boundary suite** (`node --test`, no dependencies):
  ```bash
  cd firebase/functions && npm test
  ```
- **Firestore rules**: validate before deploying (Firebase Console rules playground, or the
  Firebase CLI / MCP validator). There is no separate JS test framework configured for the
  admin app beyond the tsx scripts above.

---

## Deploying

Backend deploys from the **repo root** (single `firebase.json`); the portal deploys from
`admin/`.

```bash
# Backend — from repo root
firebase deploy --only firestore:rules        # security rules
firebase deploy --only functions              # Cloud Functions
firebase deploy                               # everything (rules + storage + functions + hosting)

# Admin portal — from admin/
npm run deploy                                # = next build && firebase deploy --only hosting
```

Hosting URL: **https://white-coffee-92c27.web.app**

Android release artifacts (signed APK/AAB) are built with Gradle (`assembleRelease` /
`bundleRelease`) and distributed outside this repo.

> If a deploy fails with `Unable to parse JSON: Unexpected token '<'`, that's a transient
> Google Cloud API hiccup — just re-run the deploy.

---

## Project conventions

- **Backend lives only in `firebase/`.** Never re-add `firestore.rules` under `android/` or
  `admin/`.
- **Each side builds independently** — there is no shared JS build graph (no Nx/Turborepo).
- **Portal access model:** `role: 'admin'` = superuser; non-admins can be granted scoped
  portal tabs via `tags` on their user doc (see `admin/src/lib/portalAccess.ts` and the
  `isAttendanceMgr()` grants in `firestore.rules`).
- **Commit hygiene:** secrets (`.env.local`, `keystore.properties`, `*.jks`,
  `local.properties`, functions `*.local`) are gitignored — keep them that way.
- Deeper, area-specific rules live in the per-directory `CLAUDE.md` files; read those before
  changing that area.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Portal loads but shows no data / permission errors | Check `.env.local` points at `white-coffee-92c27`, you're signed in as an admin/tagged user, and rules are deployed. |
| `firebase deploy` says token expired | `firebase login --reauth` (run in a real terminal). |
| Functions `npm run lint` errors on `?.` | Expected — the eslint config is stale. Use `node --check` + `npm test`. |
| Android Gradle can't find the SDK | Ensure `android/local.properties` has a valid `sdk.dir`, or open the project in Android Studio once. |
| Release build fails to sign | You're missing `android/keystore.properties` + the keystore file. |
| Sheets export cells look wrong / empty | Export logic is in `firebase/functions/index.js`; redeploy functions after changes. |

---

## Further documentation

- **`CLAUDE.md`** (root) — monorepo rules and context.
- **`admin/CLAUDE.md`** — portal architecture, Firestore collections, attendance/OT logic, the
  Google Sheets export, and the portal access/tags model.
- **`admin/docs/`** — e.g. `cloud-functions.md`, `ot-shortage-design.md`.
- **`android/README.md`**, **`android/CLAUDE.md`**, **`android/DEVELOPER_HANDBOOK.md`** — the
  Android app in depth.
