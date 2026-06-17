# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server at http://localhost:3000
npm run build        # Static export to /out (required before deploy)
npm run deploy       # build + firebase deploy --only hosting
firebase login       # One-time auth before first deploy
firebase login --reauth  # Re-authenticate when credentials expire (run in terminal, not Claude Code)
```

No test framework is configured.

## Architecture

**Next.js 14 static export** deployed to Firebase Hosting. All pages are client-side (`'use client'`) since the app uses Firebase Auth and Firestore in the browser. The `output: 'export'` in `next.config.ts` means `next start` is unused — builds produce static HTML in `/out`.

**Data flow**: Pages → `src/lib/firestore.ts` → Firebase SDK. All Firestore operations are centralized in `firestore.ts` (40+ functions). Pages use local `useState` — no global state management (no Redux, no Context).

**Auth guard**: The `(admin)` route group layout (`src/app/(admin)/layout.tsx`) listens to `onAuthStateChanged` and redirects unauthenticated users to `/login`. It also verifies `role === 'admin'` in Firestore before allowing access.

**Routing**: File-based via Next.js App Router. The `(admin)` folder is a route group (parentheses = no URL segment), so `/dashboard`, `/users`, `/sites`, `/leaves`, `/attendance`, `/submissions` are all protected.

## Firestore Collections

- `users/` — employee profiles with `role` field (`admin`, `office`, `operations`)
- `sites/` — geofenced work locations with GPS coordinates
- `users/{uid}/leave_requests/` — subcollection per user
- `users/{uid}/attendance/` — check-in/out events per user
- `users/{uid}/material_requests/` — M&T form submissions per user
- Top-level: `material_purchases`, `material_transfers`, `tool_transfers`, `work_progress`

Required Firestore composite indexes (must be created in Firebase Console):
- `leave_requests`: `status` ASC + `submittedAt` ASC
- `attendance`: `date` ASC + `timestamp` ASC
- `material_requests`: `submittedAt` DESC

## Styling Conventions

Global component classes are defined in `src/app/globals.css`: `.btn-primary`, `.btn-outline`, `.btn-danger`, `.btn-success`, `.card`, `.input`, `.label`, `.badge-*`. Use these instead of inline Tailwind for interactive elements.

Tailwind custom tokens (from `tailwind.config.ts`):
- `primary`: `#1A5FAF`
- `background`: `#F0F4F8`
- `border-custom`: `#C8D6E8`
- `text-primary`: `#0D1B2A`
- `text-secondary`: `#6B7E94`

## Environment

Firebase config lives in `.env.local` (not committed). Required variables: `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`, `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID`.

Firebase project ID: `white-coffee-92c27`. Hosting URL: `https://white-coffee-92c27.web.app`.
