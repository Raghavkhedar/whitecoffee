# WhiteCoffee Monorepo — Design Spec

**Date:** 2026-07-09
**Author:** Raghav Khedar (with Claude Code)
**Status:** Approved design → pending implementation plan

---

## Goal

Merge the two currently-separate WhiteCoffee repositories into a single monorepo so that
the Android app and its Next.js admin portal live in one place, stay in sync, and can be
reasoned about by AI tooling across both sides. The **primary win** is eliminating the
duplicated, silently-diverging Firebase backend config (`firestore.rules` et al.) by making
one copy the source of truth.

### Non-goals (explicitly out of scope for this pass)
- No changes to Android app logic or admin portal logic.
- No dependency upgrades on either side.
- No documentation cleanup (loose `*.md` files, `WhiteCoffe.zip` in the Android repo stay as-is).
- No monorepo build tooling (Nx / Turborepo / pnpm workspaces) — see "Rejected approaches".

---

## Current state (verified 2026-07-09)

| | Android | Admin |
|---|---|---|
| Local path | `~/StudioProjects/WhiteCoffee01` | `~/Projects/Office/whitecoffeeadmin` |
| GitHub | `Raghavkhedar/WhiteCoffee01` | `Raghavkhedar/whitecoffeeadmin` |
| Branch | `main` | `feat/edit-login-email` (1 commit ahead of `main`); remote-only `feat/ot-shortage-page` |
| Contents | Gradle/Kotlin app (`app/`) | Next.js (`src/`) **+ Cloud Functions (`functions/`)** |
| Firebase files | `firestore.rules` (225 lines), `storage.rules`, `firebase.json`, `.firebaserc` | `firestore.rules` (290 lines), `firebase.json`, `.firebaserc` |
| Firebase project | `white-coffee-92c27` (same as admin) | `white-coffee-92c27` (same as Android) |

### Key finding — live rules divergence
`firestore.rules` has **genuinely diverged** between the two repos. The admin copy (290 lines)
is a superset containing newer rules the Android copy (225 lines) lacks — e.g. an admin-only
`changedKeysWithin(['siteId'])` patch rule on attendance events, plus user-management plumbing.
Both repos deploy to the **same** live Firebase project, so whichever was deployed last silently
won. `storage.rules` exists only in the Android repo. This divergence is the concrete cost of the
split and the main thing the monorepo fixes.

---

## Target design

### Repository
- New local repo: `~/Projects/whitecoffee`
- New GitHub repo: `Raghavkhedar/whitecoffee` (created fresh)
- Old repos (`WhiteCoffee01`, `whitecoffeeadmin`) → **archived read-only** on GitHub after the
  monorepo is verified. **Not deleted.**

### Directory layout
```
whitecoffee/
├── android/            ← WhiteCoffee01, full git history (via git subtree)
├── admin/              ← whitecoffeeadmin: Next.js src/ + functions/, full git history
├── firebase/           ← SINGLE SOURCE OF TRUTH for backend deploy:
│                          firestore.rules, storage.rules, firestore.indexes.json,
│                          firebase.json, .firebaserc, functions/ (moved from admin/)
├── CLAUDE.md           ← root orientation; points at android/ and admin/ sub-CLAUDE.md
├── .gitignore          ← merged from both (keeps secrets untracked)
└── README.md
```

### Method: `git subtree` (history-preserving)
Each source repo is grafted into its subfolder with **full commit history intact**:
```
git subtree add --prefix=android <android-remote> main
git subtree add --prefix=admin   <admin-remote>   main
```
- **No git submodules** — submodules pin each side to a fixed commit and recreate exactly the
  drift we are trying to eliminate.
- Local paths (or GitHub URLs) may be used as the temporary subtree remotes.
- **Alternative considered:** `git filter-repo` to pre-rewrite each repo's history so paths are
  already under the subfolder. Cleaner historical paths, but more steps. **Default: subtree.**
  filter-repo is a fallback only if subtree's grafted history proves awkward.

### Firebase consolidation (the careful part — review-gated)
1. Diff `android/firestore.rules` vs `admin/firestore.rules`.
2. Take the **admin (290-line, newer) version as the base**.
3. Verify **no Android-only rule is dropped** in the process (line-by-line reconcile, not a
   blind overwrite).
4. Bring `storage.rules` (Android-only) into `firebase/`.
5. Move `functions/` from `admin/` to `firebase/functions/`; update `firebase.json`
   `functions.source` and any relative paths accordingly so `firebase/` is a self-contained
   deploy unit (`cd firebase && firebase deploy`).
6. **HARD GATE:** nothing is deployed to Firebase until the user eyeballs and approves the
   unified `firestore.rules`. Consolidation is committed to the monorepo first; deploy is a
   separate, explicit, user-confirmed step.

### Builds & tooling (unchanged)
- Android: Gradle, run from `android/` (JDK 21 daemon per existing project setup).
- Admin: npm / Next.js, run from `admin/`.
- Firebase App Distribution keystore + `keystore.properties` stay in `android/` (gitignored).
- A monorepo does **not** change how either side builds — each tool runs from its own subdir.

### AI / graphify
- Regenerate graphify at the monorepo root so the graph spans both sides.
- Root `CLAUDE.md` provides orientation and points at the two sub-`CLAUDE.md` files.
- Each subfolder keeps its own detailed `CLAUDE.md` as the authoritative context for that side.

---

## Decision checkpoints (resolved defaults, confirm during execution)
1. **Admin source ref:** bring admin in from `main` (clean baseline). The `feat/edit-login-email`
   (1 commit ahead) and remote-only `feat/ot-shortage-page` work is **re-applied in the monorepo
   afterward** — it is not lost, but it does not come along automatically with a `main` subtree.
   *Default: `main`.* (Alternative: subtree from the feature branch instead.)
2. **Old repos:** archived read-only after verification, not deleted.

---

## Rejected approaches
- **Plain copy-paste of both folders** — discards both git histories (blame, commits). Rejected;
  user explicitly wants history preserved.
- **git submodules** — pins commits, recreates the drift the monorepo is meant to kill. Rejected.
- **Nx / Turborepo / pnpm workspaces** — Gradle and Next.js share no JS build graph, so formal
  monorepo tooling adds config overhead for no benefit. Plain folders + per-subdir tooling is
  correct here (YAGNI). Rejected.

---

## Success criteria
- [ ] `~/Projects/whitecoffee` exists with `android/`, `admin/`, `firebase/` subfolders.
- [ ] `git log --follow android/app/...` and `admin/src/...` show original commit history.
- [ ] Exactly one `firestore.rules` / `storage.rules` in `firebase/`; none remaining as the
      live source in the subfolders.
- [ ] Unified `firestore.rules` reviewed and approved by user before any deploy.
- [ ] `cd android && ./gradlew :app:compileDebugKotlin` succeeds.
- [ ] `cd admin && npm run build` (or existing build command) succeeds.
- [ ] New `Raghavkhedar/whitecoffee` GitHub repo pushed; both old repos archived read-only.
- [ ] Root `CLAUDE.md` + regenerated graphify at root.
