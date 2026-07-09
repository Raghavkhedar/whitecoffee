# WhiteCoffee Monorepo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the separate `WhiteCoffee01` (Android) and `whitecoffeeadmin` (Next.js + Cloud Functions) repos into one `whitecoffee` monorepo with full history preserved and a single source of truth for Firebase backend config.

**Architecture:** A fresh git repo grafts each source repo into a subfolder via `git subtree` (history intact, no submodules). Backend deploy config is consolidated into one root `firebase.json` + `.firebaserc` plus a `firebase/` folder holding the reconciled rules and the Cloud Functions. Each side keeps building independently (Gradle in `android/`, npm in `admin/`).

**Tech Stack:** git (subtree), GitHub CLI (`gh`), Firebase CLI, Gradle (JDK 21 daemon), Next.js/npm, graphify.

## Global Constraints

- Non-destructive only: **never** modify or delete the two source repos. All operations read from them.
- Firebase project is `white-coffee-92c27` for both sides — must stay unchanged.
- **HARD GATE:** no `firebase deploy` of any kind runs until the user reviews and approves the unified `firestore.rules`. Until then the live rules stay as currently deployed.
- Secrets stay untracked: `keystore.properties`, `keystore/*.jks`, `local.properties`, `admin/.env.local`, `functions/*.local`. Verify before every push.
- Old repos are **archived read-only, not deleted**, and only after both builds verify.
- Admin is brought in from **`feat/edit-login-email`** (superset of `main`; contains the extra login-email/user-management commit). `main` alone would drop that work.
- "Test" for each task = the stated verification command producing the expected output. Commit after each task.

**Source repo paths (verified 2026-07-09):**
- Android: `/home/crispy/StudioProjects/WhiteCoffee01` (branch `main`)
- Admin: `/home/crispy/Projects/Office/whitecoffeeadmin` (branch `feat/edit-login-email`)
- Monorepo target: `/home/crispy/Projects/whitecoffee`
- New GitHub repo: `Raghavkhedar/whitecoffee` (private)

---

## Target layout

```
whitecoffee/
├── firebase.json          ← ROOT single source (paths relative to root)
├── .firebaserc            ← ROOT (project: white-coffee-92c27)
├── .gitignore             ← merged from both repos
├── README.md
├── CLAUDE.md              ← root orientation → android/ + admin/ sub-CLAUDE.md
├── android/               ← WhiteCoffee01 (full history, subtree)
├── admin/                 ← whitecoffeeadmin: Next.js src/ (full history, subtree)
│                            (its firebase.json/.firebaserc/firestore.rules removed post-merge)
└── firebase/
    ├── firestore.rules    ← reconciled (admin 290-line base + any android-only rule)
    ├── storage.rules      ← from android (admin never had one)
    └── functions/         ← moved from admin/functions
```

Root `firebase.json` to be created (Task 5):
```json
{
  "firestore": { "rules": "firebase/firestore.rules" },
  "storage":   { "rules": "firebase/storage.rules" },
  "hosting": {
    "public": "admin/out",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "cleanUrls": true,
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "functions": [
    {
      "source": "firebase/functions",
      "codebase": "default",
      "disallowLegacyRuntimeConfig": true,
      "ignore": ["node_modules", ".git", "firebase-debug.log", "firebase-debug.*.log", "*.local"],
      "predeploy": []
    }
  ]
}
```

---

## Task 0: Pre-flight — decide what uncommitted work travels

**Files:** none created; operates on source repos only.

**Context:** `git subtree` only pulls **committed** refs. Admin's tree is clean. Android's `main` has uncommitted items that will NOT travel unless committed first:
- `.idea/codeStyles/Project.xml` (modified, tracked)
- `docs/` (untracked — contains this plan + the design spec)
- `scripts/` (untracked)

Nothing is lost either way (the old Android repo is archived, not deleted), but decide what should be in the monorepo from day one.

- [ ] **Step 1: Show exactly what is uncommitted in Android**

Run: `git -C /home/crispy/StudioProjects/WhiteCoffee01 status --porcelain`
Expected: lists ` M .idea/codeStyles/Project.xml`, `?? docs/`, `?? scripts/`.

- [ ] **Step 2: Commit the artifacts you want to travel (recommended: docs/ + scripts/)**

```bash
cd /home/crispy/StudioProjects/WhiteCoffee01
git checkout main   # ensure on main; abort if not and confirm with user
git add docs/ scripts/
git commit -m "chore: add monorepo design spec + scripts before migration"
```
Leave `.idea/codeStyles/Project.xml` uncommitted unless the user wants IDE config tracked.

- [ ] **Step 3: Verify Android main is now clean of the wanted items**

Run: `git -C /home/crispy/StudioProjects/WhiteCoffee01 status --porcelain`
Expected: only ` M .idea/codeStyles/Project.xml` remains (or nothing, if user committed it too).

- [ ] **Step 4: Confirm admin ref to import**

Run: `git -C /home/crispy/Projects/Office/whitecoffeeadmin log --oneline main..feat/edit-login-email`
Expected: shows `244986a Admin: edit employee login email; user-management plumbing` (confirms feat is the superset to import).

_No commit in the monorepo yet — this task only prepares the sources._

---

## Task 1: Initialize the monorepo skeleton

**Files:**
- Create: `/home/crispy/Projects/whitecoffee/README.md`

**Interfaces:**
- Produces: an initialized git repo at `~/Projects/whitecoffee` on branch `main` with one base commit, ready for subtree grafts.

- [ ] **Step 1: Create and init the repo**

```bash
mkdir -p /home/crispy/Projects/whitecoffee
cd /home/crispy/Projects/whitecoffee
git init -b main
```

- [ ] **Step 2: Write a minimal README**

```bash
cat > README.md <<'EOF'
# WhiteCoffee Monorepo

Field Operations Management for Senken Engineering.

- `android/` — Android app (Kotlin, Jetpack Compose, Gradle)
- `admin/` — Next.js admin portal
- `firebase/` — Firestore/Storage rules + Cloud Functions (single source of truth)

Firebase project: `white-coffee-92c27`. Deploy backend from repo root: `firebase deploy`.
EOF
```

- [ ] **Step 3: Base commit**

```bash
git add README.md
git commit -m "chore: initialize whitecoffee monorepo"
```

- [ ] **Step 4: Verify**

Run: `git -C /home/crispy/Projects/whitecoffee log --oneline`
Expected: one commit, "chore: initialize whitecoffee monorepo".

---

## Task 2: Graft the Android repo into `android/` (history preserved)

**Files:**
- Create: `android/**` (entire Android repo content under the prefix)

**Interfaces:**
- Consumes: initialized monorepo from Task 1; Android `main` from Task 0.
- Produces: `android/` populated; `git log -- android/` shows original Android history.

- [ ] **Step 1: Add the Android source as a temporary remote and fetch**

```bash
cd /home/crispy/Projects/whitecoffee
git remote add android-src /home/crispy/StudioProjects/WhiteCoffee01
git fetch android-src
```
Expected: fetch reports branches including `android-src/main`.

- [ ] **Step 2: Subtree-add into `android/` (no --squash, to keep history)**

```bash
git subtree add --prefix=android android-src main
```
Expected: ends with `Merge commit ... ` / "Added dir 'android'". No errors.

- [ ] **Step 3: Remove the temporary remote**

```bash
git remote remove android-src
```

- [ ] **Step 4: Verify content and history came through**

Run: `ls /home/crispy/Projects/whitecoffee/android/app && git -C /home/crispy/Projects/whitecoffee log --oneline -- android/ | tail -3`
Expected: `app/` exists; the oldest Android commits appear in the log (history preserved, not squashed).

---

## Task 3: Graft the Admin repo into `admin/` (from feat branch, history preserved)

**Files:**
- Create: `admin/**` (entire admin repo content, including `functions/` for now)

**Interfaces:**
- Consumes: monorepo with `android/` from Task 2.
- Produces: `admin/` populated from `feat/edit-login-email`; `functions/` present at `admin/functions/` (moved in Task 4).

- [ ] **Step 1: Add the Admin source as a temporary remote and fetch**

```bash
cd /home/crispy/Projects/whitecoffee
git remote add admin-src /home/crispy/Projects/Office/whitecoffeeadmin
git fetch admin-src
```
Expected: fetch reports `admin-src/feat/edit-login-email` and `admin-src/main`.

- [ ] **Step 2: Subtree-add the feat branch into `admin/`**

```bash
git subtree add --prefix=admin admin-src feat/edit-login-email
```
Expected: "Added dir 'admin'". No errors.

- [ ] **Step 3: Remove the temporary remote**

```bash
git remote remove admin-src
```

- [ ] **Step 4: Verify content + that the feat-only commit is present**

Run: `ls /home/crispy/Projects/whitecoffee/admin/src && git -C /home/crispy/Projects/whitecoffee log --oneline -- admin/ | grep -i "edit employee login email"`
Expected: `src/` exists; the "edit employee login email; user-management plumbing" commit is in the log (feat work preserved).

---

## Task 4: Move Cloud Functions + rules into `firebase/`

**Files:**
- Create: `firebase/functions/` (git-moved from `admin/functions/`)
- Create: `firebase/storage.rules` (git-moved from `android/storage.rules`)
- (rules file handled in Task 5's reconcile)

**Interfaces:**
- Consumes: `admin/functions/` (Task 3), `android/storage.rules` (Task 2).
- Produces: `firebase/functions/` and `firebase/storage.rules` in place for the root `firebase.json` to reference.

- [ ] **Step 1: Create the firebase/ folder and move functions with git (preserves history)**

```bash
cd /home/crispy/Projects/whitecoffee
mkdir -p firebase
git mv admin/functions firebase/functions
```

- [ ] **Step 2: Move storage.rules (android-only) into firebase/**

```bash
git mv android/storage.rules firebase/storage.rules
```

- [ ] **Step 3: Verify moves**

Run: `ls firebase/functions/index.js firebase/storage.rules && ls admin/functions 2>&1 | head -1`
Expected: `firebase/functions/index.js` and `firebase/storage.rules` exist; `admin/functions` no longer exists (`No such file or directory`).

- [ ] **Step 4: Commit the relocation**

```bash
git add -A
git commit -m "chore: relocate cloud functions + storage rules into firebase/"
```

---

## Task 5: Reconcile firestore.rules + create the single root firebase config

**Files:**
- Create: `firebase/firestore.rules` (reconciled)
- Create: `firebase.json` (root), `.firebaserc` (root)
- Delete: `android/firebase.json`, `android/.firebaserc`, `android/firestore.rules`, `admin/firebase.json`, `admin/.firebaserc`, `admin/firestore.rules`

**Interfaces:**
- Consumes: `android/firestore.rules` (225 lines), `admin/firestore.rules` (290 lines), `firebase/storage.rules`, `firebase/functions/`.
- Produces: exactly one authoritative `firebase/firestore.rules` + one root `firebase.json`/`​.firebaserc`; no deploy config left in the subfolders.

- [ ] **Step 1: Diff the two rule files to find any android-only rule**

```bash
cd /home/crispy/Projects/whitecoffee
diff android/firestore.rules admin/firestore.rules > /tmp/rules.diff; echo "exit=$?"
grep -c '^<' /tmp/rules.diff   # lines only in android
```
Expected: a diff is produced (files differ). Review `/tmp/rules.diff`: the admin (290-line) side should be a superset (adds the admin `changedKeysWithin(['siteId'])` attendance rule + user-management rules). Confirm no *android-only* rule (a `^<` line that is a real `allow`/`match` not present on the admin side) would be lost.

- [ ] **Step 2: Adopt the admin version as the reconciled base**

```bash
cp admin/firestore.rules firebase/firestore.rules
```
If Step 1 surfaced any genuine android-only rule, hand-merge it into `firebase/firestore.rules` before continuing. (Expected from the 2026-07-09 diff: none — admin is a strict superset.)

- [ ] **Step 3: Write the single root firebase.json**

Create `/home/crispy/Projects/whitecoffee/firebase.json` with exactly the JSON shown in the "Target layout" section above (firestore→`firebase/firestore.rules`, storage→`firebase/storage.rules`, hosting→`admin/out`, functions.source→`firebase/functions`).

- [ ] **Step 4: Write the single root .firebaserc**

```bash
cat > /home/crispy/Projects/whitecoffee/.firebaserc <<'EOF'
{
  "projects": {
    "default": "white-coffee-92c27"
  }
}
EOF
```

- [ ] **Step 5: Remove the now-duplicate per-subfolder deploy config**

```bash
git rm android/firebase.json android/.firebaserc android/firestore.rules \
       admin/firebase.json admin/.firebaserc admin/firestore.rules
```
Expected: all six removed. (Android `google-services.json` and app code are untouched — those are not deploy config.)

- [ ] **Step 6: Validate the unified rules WITHOUT deploying**

Run: `cd /home/crispy/Projects/whitecoffee && firebase deploy --only firestore:rules --dry-run 2>&1 | tail -5 || echo "if --dry-run unsupported, use the Firebase MCP validate_security_rules tool on firebase/firestore.rules"`
Expected: rules **compile/validate** with no syntax errors. **Do NOT actually deploy** (see HARD GATE). If the CLI has no dry-run, validate via the `firebase_validate_security_rules` MCP tool against `firebase/firestore.rules`.

- [ ] **Step 7: Commit the consolidation**

```bash
git add -A
git commit -m "chore: consolidate Firebase config into root firebase.json + firebase/ (single source of truth)"
```

- [ ] **Step 8: USER GATE — pause for rules review**

Present the reconciled `firebase/firestore.rules` (and the diff) to the user. Do not proceed to any deploy. Deployment is Task 9, user-triggered only.

---

## Task 6: Merge .gitignore and verify no secrets are tracked

**Files:**
- Create: `/home/crispy/Projects/whitecoffee/.gitignore` (merged)

**Interfaces:**
- Consumes: `android/.gitignore`, `admin/.gitignore`, `firebase/functions/.gitignore`.
- Produces: a root `.gitignore` covering both stacks; confirmation that secrets are untracked.

- [ ] **Step 1: Create a root .gitignore covering both stacks**

```bash
cat > /home/crispy/Projects/whitecoffee/.gitignore <<'EOF'
# Secrets (never commit)
keystore.properties
**/keystore.properties
*.jks
*.keystore
**/local.properties
admin/.env.local
**/.env.local
firebase/functions/*.local

# Android / Gradle
android/.gradle/
android/.kotlin/
android/build/
android/app/build/
android/local.properties

# Node / Next.js
admin/node_modules/
admin/.next/
admin/out/
firebase/functions/node_modules/

# Firebase
.firebase/
firebase-debug.log
firebase-debug.*.log

# Graphify (regenerated at root)
graphify-out/
EOF
```
The per-subfolder `.gitignore` files from each source repo remain and still apply to their subtrees; this root file adds monorepo-wide coverage.

- [ ] **Step 2: Verify NO secret/build artifact is currently tracked**

Run:
```bash
cd /home/crispy/Projects/whitecoffee
git ls-files | grep -E 'keystore\.properties|\.jks$|\.env\.local$|local\.properties$' || echo "OK: no secrets tracked"
```
Expected: `OK: no secrets tracked`. If anything prints, `git rm --cached` it before continuing.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add merged root .gitignore"
```

---

## Task 7: Root CLAUDE.md + regenerate graphify

**Files:**
- Create: `/home/crispy/Projects/whitecoffee/CLAUDE.md`
- Create: `graphify-out/` (generated, gitignored per Task 6)

**Interfaces:**
- Consumes: existing `android/CLAUDE.md`, `admin/CLAUDE.md` (both preserved by their subtrees).
- Produces: a root orientation file; a root-level knowledge graph spanning both sides.

- [ ] **Step 1: Write the root CLAUDE.md (orientation only — sub-files stay authoritative)**

```bash
cat > /home/crispy/Projects/whitecoffee/CLAUDE.md <<'EOF'
# WhiteCoffee Monorepo — Root Context

Two products for Senken Engineering, one Firebase project (`white-coffee-92c27`):

- **`android/`** — Android app (Kotlin, Jetpack Compose, Gradle). Authoritative context: `android/CLAUDE.md`. Build: `cd android && ./gradlew :app:compileDebugKotlin`.
- **`admin/`** — Next.js admin portal. Authoritative context: `admin/CLAUDE.md`. Build: `cd admin && npm run build`.
- **`firebase/`** — SINGLE source of truth for backend: `firestore.rules`, `storage.rules`, `functions/`. Deploy from repo root: `firebase deploy`.

## Rules of the monorepo
- Firestore/Storage rules live ONLY in `firebase/`. Never re-add a `firestore.rules` inside `android/` or `admin/` — that duplication is exactly what this monorepo removed.
- Each side builds independently; there is no shared JS build graph (no Nx/Turborepo).
- Deploy backend from root via the single root `firebase.json`.
EOF
```

- [ ] **Step 2: Regenerate the knowledge graph at root**

Run: `cd /home/crispy/Projects/whitecoffee && graphify update . || graphify .`
Expected: `graphify-out/graph.json` produced at root. (It is gitignored; regenerate locally as needed.)

- [ ] **Step 3: Commit the root context**

```bash
cd /home/crispy/Projects/whitecoffee
git add CLAUDE.md
git commit -m "docs: add root CLAUDE.md orienting across android/admin/firebase"
```

---

## Task 8: Verify both apps still build (before touching anything old)

**Files:** none modified — verification only.

**Interfaces:**
- Consumes: the assembled monorepo.
- Produces: proof that Android compiles and admin builds from their new locations.

- [ ] **Step 1: Android type-check compiles from android/**

Run: `cd /home/crispy/Projects/whitecoffee/android && ./gradlew :app:compileDebugKotlin --console=plain`
Expected: `BUILD SUCCESSFUL`. (JDK 21 daemon is pinned via `android/gradle/gradle-daemon-jvm.properties`; do not set JAVA_HOME.)

- [ ] **Step 2: Admin installs + builds from admin/**

Run:
```bash
cd /home/crispy/Projects/whitecoffee/admin
npm ci
npm run build
```
Expected: `npm ci` restores `node_modules`; `next build` completes with no errors and produces `admin/out/` (or `.next/`).

- [ ] **Step 3: Confirm functions still resolve from firebase/functions**

Run: `cd /home/crispy/Projects/whitecoffee/firebase/functions && npm ci && node -e "require('./index.js'); console.log('functions load OK')" 2>&1 | tail -3`
Expected: loads without a module-resolution crash (`functions load OK`), or at minimum `npm ci` succeeds. If `index.js` has side-effects on require, skip the `node -e` and rely on `npm ci` success.

- [ ] **Step 4: STOP if either build fails.** Do not archive or push anything until both succeed. Fix or report before proceeding.

---

## Task 9: Publish the monorepo to GitHub + deploy gate

**Files:** none — remote/publish operations.

**Interfaces:**
- Consumes: fully verified local monorepo.
- Produces: `Raghavkhedar/whitecoffee` on GitHub with all history.

- [ ] **Step 1: Confirm secrets still untracked right before publishing**

Run: `cd /home/crispy/Projects/whitecoffee && git ls-files | grep -E 'keystore\.properties|\.jks$|\.env\.local$' || echo "OK: clean to push"`
Expected: `OK: clean to push`.

- [ ] **Step 2: Create the private GitHub repo and push**

```bash
cd /home/crispy/Projects/whitecoffee
gh repo create Raghavkhedar/whitecoffee --private --source=. --remote=origin --push
```
Expected: repo created; `main` pushed with full history.

- [ ] **Step 3: Spot-check history on GitHub**

Run: `gh repo view Raghavkhedar/whitecoffee --web` (or `git log --oneline | wc -l`)
Expected: commit count roughly equals Android + Admin + the few monorepo chore commits (history preserved, not squashed).

- [ ] **Step 4: USER-TRIGGERED backend deploy (only after Task 5 rules approval)**

Once the user has approved the unified rules:
```bash
cd /home/crispy/Projects/whitecoffee
firebase deploy --only firestore:rules,storage
# functions/hosting deploy only if the user wants it this pass:
# firebase deploy --only functions,hosting
```
Expected: rules deploy succeeds against `white-coffee-92c27`. **Do not run this without explicit user go-ahead.**

---

## Task 10: Archive the old repos (last step, reversible)

**Files:** none — GitHub settings only.

**Interfaces:**
- Consumes: verified + published monorepo.
- Produces: old repos flipped to read-only archive (recoverable; feature branch `feat/ot-shortage-page` remains here).

- [ ] **Step 1: Confirm the monorepo is fully pushed and both builds passed (Tasks 8–9).**

- [ ] **Step 2: Archive both old GitHub repos (read-only, not deleted)**

```bash
gh repo archive Raghavkhedar/WhiteCoffee01 --yes
gh repo archive Raghavkhedar/whitecoffeeadmin --yes
```
Expected: both marked archived. Local clones remain untouched on disk.

- [ ] **Step 3: (Optional) Note recovery path for the remote-only feature branch**

`feat/ot-shortage-page` and any unmerged admin work remain retrievable from the archived `whitecoffeeadmin` repo. If it should live in the monorepo, cherry-pick or subtree it into `admin/` as a follow-up (out of scope for this plan).

---

## Rollback

At any point before Task 10, the monorepo is disposable:
```bash
rm -rf /home/crispy/Projects/whitecoffee   # local
gh repo delete Raghavkhedar/whitecoffee --yes   # remote, if already pushed
```
The two source repos are never modified, so deleting the monorepo loses nothing. No Firebase deploy happens until the user approves (Task 9 Step 4), so live rules are unaffected until then.
