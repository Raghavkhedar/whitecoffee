# Requirements

Everything you need installed and configured to build and run WhiteCoffee. Pair this with the
setup steps in [`README.md`](./README.md).

You only need the toolchain for the part(s) you work on:

- **Admin portal only** → Node + npm + Firebase CLI.
- **Backend (rules/functions)** → Node 24 + Firebase CLI.
- **Android app** → JDK 17 + Android Studio / Android SDK (+ Firebase CLI is not required).

---

## 1. Toolchain

| Tool | Version | Needed for | Notes |
|---|---|---|---|
| **Node.js** | **20 LTS or newer** for `admin/`; **24** for `firebase/functions/` | Admin portal, Cloud Functions | Functions pin `engines.node = 24`, so use Node 24 when running/deploying them. A version manager (`nvm`, `fnm`, `volta`) makes switching easy. |
| **npm** | 9+ (ships with Node) | Admin portal, Cloud Functions | Yarn/pnpm are not used. |
| **Firebase CLI** | latest (`npm i -g firebase-tools`) | Deploys, functions emulator, rules | Must be logged in (`firebase login`) with access to `white-coffee-92c27`. |
| **Git** | any recent | Everything | — |
| **JDK** | **17** | Android app | The app compiles/targets JVM 17. |
| **Android Studio** | latest stable (Ladybug+) | Android app | Bundles the right Gradle/AGP tooling; also creates `local.properties`. |
| **Android SDK** | **API 35** (compile & target); **min API 26** | Android app | Install via Android Studio SDK Manager. |
| **Gradle** | 8.9 (via the committed wrapper — do not install separately) | Android app | Use `./gradlew`; the wrapper pins the version. |

### Android build versions (informational — pinned in the repo)

These come from `android/gradle/libs.versions.toml` and `android/app/build.gradle.kts`; you do
not set them manually, but they define the environment the wrapper expects:

- Android Gradle Plugin (AGP): **8.7.3**
- Kotlin: **2.0.21**
- `compileSdk` / `targetSdk`: **35** · `minSdk`: **26**
- `applicationId`: `com.raghav.whitecoffee`

### Cloud Functions runtime deps (installed via `npm install`)

- `firebase-admin` ^13, `firebase-functions` ^7, `googleapis` ^173.

### Admin portal deps (installed via `npm install`)

- Next.js `14.2.3`, React 18, Firebase Web SDK ^10, Tailwind 3, TypeScript 5, `xlsx`.

---

## 2. Config & secret files to provide

None of these are committed (they're gitignored). Obtain them from a maintainer / the Firebase
Console and place them exactly as shown. **Do not commit them.**

### 2.1 Admin portal — `admin/.env.local`

Copy the template and fill in real values:

```bash
cd admin
cp .env.local.example .env.local
```

Values come from **Firebase Console → Project settings → General → Your apps → Web app → SDK
setup and configuration**. All six are required:

| Variable | Example / source |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `apiKey` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `white-coffee-92c27.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `white-coffee-92c27` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `white-coffee-92c27.firebasestorage.app` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `appId` |

> These are Firebase **web** identifiers, not passwords — access is enforced by Firestore/
> Storage rules, not by hiding these keys. They still live in `.env.local` (gitignored) so each
> environment supplies its own.

### 2.2 Android — Firebase config

- `android/app/google-services.json` — **already committed**. If you need to regenerate it,
  download from Firebase Console → Project settings → Android app (`com.raghav.whitecoffee`).

### 2.3 Android — local & signing config

| File | Keys | When |
|---|---|---|
| `android/local.properties` | `sdk.dir=<path to Android SDK>` | Always (auto-created by Android Studio). |
| `android/keystore.properties` | `storeFile`, `storePassword`, `keyAlias`, `keyPassword` | Only for **signed release** builds. Get from a maintainer; keep the `.jks`/`.keystore` out of git. |

### 2.4 Cloud Functions — secrets (Secret Manager, not files)

The `exportToSheets` function reads two secrets at runtime. Set them once per project via the
Firebase CLI (you'll be prompted for the value):

```bash
firebase functions:secrets:set ATTENDANCE_SHEETS_KEY   # Google service-account JSON (Sheets API)
firebase functions:secrets:set MAPS_API_KEY            # Google Maps API key (reverse geocoding)
```

The target Google Sheet IDs are hard-coded in `firebase/functions/index.js` (not secrets).

---

## 3. Access you need

- A Firebase account with access to the **`white-coffee-92c27`** project (for deploys,
  emulators, and downloading config).
- An **admin** login (or a user with a portal-access **tag**) to sign into the admin portal.
- The Google service account behind `ATTENDANCE_SHEETS_KEY` must have edit access to the export
  spreadsheet(s).

---

## 4. Quick verification

After installing, confirm each part is ready:

```bash
node -v          # 20+ (24 for functions)
npm -v
firebase --version
java -version     # 17.x  (Android only)

# Admin builds:
cd admin && npm install && npm run build

# Functions test suite:
cd ../firebase/functions && npm install && npm test

# Android compiles (Android only):
cd ../../android && ./gradlew :app:compileDebugKotlin
```

If all four succeed, your environment is correctly set up.
