# Admin Login Pending-Reminder Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin logs into the admin portal, show a dismissable popup (with a short chime) reporting how many leave requests, regularization requests, and OT approvals are pending — but only when there's at least one.

**Architecture:** Three independent Firestore counts (two already-existing helpers, one new pure aggregation function plus a thin async wrapper) fetched from a new `PendingReminderPopup` client component, rendered from the admin layout only for `role === 'admin'`, gated by a `sessionStorage` flag so it doesn't repeat on every page refresh within the same login.

**Tech Stack:** Next.js 14 (App Router, static export), TypeScript, Firebase client SDK (`firebase/firestore`), Tailwind. No component test framework exists in this repo (per `admin/CLAUDE.md`) — the one genuinely pure function gets a `tsx`-run unit test; everything else is verified by `npx tsc --noEmit`, `npm run build`, and manual QA, matching how every other admin feature in this codebase is verified.

**Spec:** `docs/superpowers/specs/2026-09-17-admin-login-pending-reminder-popup-design.md`

## Global Constraints

- **Admin only.** Gate is `portalUser.role === 'admin'` in `admin/src/app/(admin)/layout.tsx` — no `tabAccess`-scoped visibility for other managers.
- **Only renders when the summed count is `> 0`.** Zero pending items across all three categories → no popup, no sound.
- **Stays until dismissed.** No auto-timeout. Clicking a category link also dismisses (navigating away removes it anyway).
- **`sessionStorage` key `adminPendingPopupShown`** (exported as `POPUP_SESSION_KEY` from `PendingReminderPopup.tsx`), set immediately after the fetch attempt completes — regardless of outcome — so a page refresh mid-session never re-fetches or re-shows it. Cleared on logout (`Sidebar.tsx`'s `handleLogout`) so a genuine new login in the same tab shows it again.
- **OT pending count** uses `usesOtShortageLedger(role)` (operations only — matches `ot-settlements/page.tsx`'s own filter, not the broader `tracksShortage`) over the last 30 days (`istDaysAgoStr(30)` → `istTodayStr()`, the same default `/ot-shortage` itself uses), built on the existing pure `computeRangeLedger` from `src/lib/otAggregate.ts` — no logic duplicated from the OT page.
- **Sound**: `admin/public/sounds/notification.wav`, played via `new Audio(...).play().catch(() => {})` — a blocked/failed autoplay must never hide the popup.
- Every fetch failure is caught **per category** — one failing category is simply omitted, never blocks the other two or the popup itself.

---

### Task 1: Notification sound asset

**Files:**
- Create: `admin/public/sounds/notification.wav`

**Interfaces:**
- Produces: a static asset served at `/sounds/notification.wav` by Next's static export, consumed by Task 4's `PendingReminderPopup`.

There's no existing audio asset anywhere in this repo, and no license-free file to point at, so this generates a short, self-contained two-note chime (A5 → E5, exponential decay) as a WAV — no external download, no attribution needed.

- [ ] **Step 1: Generate the file**

Run from the repo root (`/home/crispy/Projects/Office/whitecoffee`):

```bash
mkdir -p admin/public/sounds
python3 - <<'PYEOF'
import wave, struct, math

SR = 44100

def note(freq, dur, vol=0.3, decay=6.0):
    n = int(SR * dur)
    out = []
    for i in range(n):
        t = i / SR
        env = math.exp(-decay * t)
        out.append(math.sin(2 * math.pi * freq * t) * env * vol)
    return out

a = note(880.0, 0.35)   # A5
b = note(659.25, 0.5)   # E5
gap = int(SR * 0.06)
samples = a + [0.0] * gap + b

frames = bytearray()
for s in samples:
    v = max(-1.0, min(1.0, s))
    frames += struct.pack('<h', int(v * 32767))

with wave.open('admin/public/sounds/notification.wav', 'wb') as f:
    f.setnchannels(1)
    f.setsampwidth(2)
    f.setframerate(SR)
    f.writeframes(bytes(frames))

print('wrote', len(frames), 'bytes')
PYEOF
```

Expected output: `wrote 80260 bytes`.

- [ ] **Step 2: Verify the file**

```bash
ls -la admin/public/sounds/notification.wav
python3 -c "import wave; w = wave.open('admin/public/sounds/notification.wav'); print(w.getnframes() / w.getframerate())"
```

Expected: file exists (~80KB), duration prints `~0.91` (seconds).

- [ ] **Step 3: Commit**

```bash
git add admin/public/sounds/notification.wav
git commit -m "feat(admin): add synthesized notification chime for login reminder popup"
```

---

### Task 2: Pure `pendingOtDayCount` aggregation

**Files:**
- Modify: `admin/src/lib/otAggregate.ts`
- Test: `admin/src/lib/otAggregate.test.ts`

**Interfaces:**
- Consumes: existing `computeRangeLedger(userId, events, planned, approvals, statuses, holidays): RangeLedger` (same file), `usesOtShortageLedger(role: string): boolean` from `./roleCapabilities`.
- Produces: `pendingOtDayCount(users: { id: string; role: string }[], events: AttendanceRecord[], planned: PlannedHours[], approvals: OtApproval[], statuses: AttendanceStatus[], holidays: Set<string>): number` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Open `admin/src/lib/otAggregate.test.ts`. Change the import line at the top from:

```ts
import { computeRangeLedger, settlementCash } from './otAggregate';
```

to:

```ts
import { computeRangeLedger, settlementCash, pendingOtDayCount } from './otAggregate';
```

Then add this block right before the final summary lines (`console.log(\`\n${failed === 0 ? '✅' : '❌'} ...`)):

```ts
console.log('\npendingOtDayCount — total pending OT DAYS across ledger-tracking (operations) users, for the admin login popup:');
const opsA   = { id: 'u1', role: 'operations' };
const opsB   = { id: 'u5', role: 'operations' };
const salesC = { id: 'u6', role: 'sales' };
const evOpsB = [ev('u5', '2026-06-07', 'site_in', '11:00'), ev('u5', '2026-06-07', 'site_out', '16:00')]; // another ops user's own pending Sunday
eq('single ops user, 1 pending Sunday day', pendingOtDayCount([opsA], evSun, [], [], [], noHol), 1);
eq('sales user excluded even with the same pending-shaped fixture', pendingOtDayCount([salesC], evSun, [], [], [], noHol), 0);
eq('two ops users, each with their own pending Sunday, sums to 2', pendingOtDayCount([opsA, opsB], [...evSun, ...evOpsB], [], [], [], noHol), 2);
```

(`evSun`, `ev`, `noHol` are already defined earlier in this file — this reuses the existing Sunday rest-day fixture.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd admin && npx tsx src/lib/otAggregate.test.ts`
Expected: FAIL — TypeScript error, `Module '"./otAggregate"' has no exported member 'pendingOtDayCount'.`

- [ ] **Step 3: Implement**

In `admin/src/lib/otAggregate.ts`, add the import (alongside the existing type-only import at the top):

```ts
import { usesOtShortageLedger } from './roleCapabilities';
```

Then add this function at the end of the file, after `settlementCash`:

```ts
// Total pending OT DAYS across every ledger-tracking (operations) user in the given range —
// counts days, not minutes, to match "N OT approvals pending" phrasing on the admin login
// reminder popup. `usesOtShortageLedger` matches the filter ot-settlements/page.tsx already
// uses (operations only — broader than tracksShortage, which also covers office/admin).
export function pendingOtDayCount(
  users: { id: string; role: string }[],
  events: AttendanceRecord[],
  planned: PlannedHours[],
  approvals: OtApproval[],
  statuses: AttendanceStatus[],
  holidays: Set<string>,
): number {
  return users
    .filter(u => usesOtShortageLedger(u.role))
    .reduce((sum, u) => sum + computeRangeLedger(u.id, events, planned, approvals, statuses, holidays).pendingDates.length, 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd admin && npx tsx src/lib/otAggregate.test.ts`
Expected: PASS — ends with `✅ N passed, 0 failed` (N = previous count + 3).

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/otAggregate.ts admin/src/lib/otAggregate.test.ts
git commit -m "feat(admin): add pendingOtDayCount for the login reminder popup"
```

---

### Task 3: `getPendingOtCount()` Firestore wrapper

**Files:**
- Modify: `admin/src/lib/firestore.ts`

**Interfaces:**
- Consumes: `pendingOtDayCount` (Task 2); existing `getAllUsers()`, `getAttendanceForDateRange(start, end)`, `getPlannedHoursForDateRange(start, end)`, `getOtApprovalsForDateRange(start, end)`, `getHolidaysForDateRange(start, end)`, `getAttendanceStatusForDateRange(start, end)`; `istTodayStr()` (already imported), `istDaysAgoStr(n)` (not yet imported here).
- Produces: `getPendingOtCount(): Promise<number>` — consumed by Task 4.

No automated test for this task: it's a thin async Firestore-fetching wrapper with no emulator harness in this repo (every other async Firestore function in `firestore.ts` is likewise untested — only the pure logic modules get `tsx` tests). Verified by typecheck now and by manual QA in Task 5.

- [ ] **Step 1: Add the `istDaysAgoStr` import**

In `admin/src/lib/firestore.ts`, change:

```ts
import { istTodayStr } from './date';
```

to:

```ts
import { istTodayStr, istDaysAgoStr } from './date';
```

- [ ] **Step 2: Add the `pendingOtDayCount` import**

Add a new import line near the other `./otAggregate`-adjacent imports (right after the `otLedger` import):

```ts
import { WO_DEBIT_MINS } from './otLedger';
import { pendingOtDayCount } from './otAggregate';
```

- [ ] **Step 3: Add `getPendingOtCount`**

In `admin/src/lib/firestore.ts`, insert this function right after `writeOtDecision` ends (immediately before the `// ── Monthly Settlements ──` section marker):

```ts
// Total pending-OT DAYS across every ledger-tracking (operations) employee, over the same
// last-30-days range /ot-shortage itself defaults to. Used only by the admin login reminder
// popup — pays the same collectionGroup(attendance) cost that page already pays on open; this
// just moves it to login time (see docs/superpowers/specs/2026-09-17-admin-login-pending-reminder-popup-design.md).
export async function getPendingOtCount(): Promise<number> {
  const end   = istTodayStr();
  const start = istDaysAgoStr(30);
  const [users, events, planned, approvals, holidaysList, statuses] = await Promise.all([
    getAllUsers(),
    getAttendanceForDateRange(start, end),
    getPlannedHoursForDateRange(start, end),
    getOtApprovalsForDateRange(start, end),
    getHolidaysForDateRange(start, end),
    getAttendanceStatusForDateRange(start, end),
  ]);
  const holidaySet = new Set(holidaysList.map(h => h.date));
  return pendingOtDayCount(users, events, planned, approvals, statuses, holidaySet);
}
```

- [ ] **Step 4: Typecheck**

Run: `cd admin && npx tsc --noEmit -p tsconfig.json`
Expected: the single pre-existing, unrelated error in `src/lib/compensation.test.ts:20` only (confirmed present before this plan via `git stash`) — no new errors.

- [ ] **Step 5: Commit**

```bash
git add admin/src/lib/firestore.ts
git commit -m "feat(admin): add getPendingOtCount for the login reminder popup"
```

---

### Task 4: `PendingReminderPopup` component

**Files:**
- Create: `admin/src/components/PendingReminderPopup.tsx`

**Interfaces:**
- Consumes: `getAllLeaveRequests('pending')`, `getAllRegularizationRequests('pending')` (existing, `src/lib/firestore.ts`), `getPendingOtCount()` (Task 3).
- Produces: default export `PendingReminderPopup` (a React component, no props) and named export `POPUP_SESSION_KEY: string` — both consumed by Task 5.

No automated test (no component test framework in this repo). Verified by typecheck now, `npm run build` and manual QA in Task 5.

- [ ] **Step 1: Write the component**

Create `admin/src/components/PendingReminderPopup.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAllLeaveRequests, getAllRegularizationRequests, getPendingOtCount } from '@/lib/firestore';

// Cleared on logout (Sidebar.tsx) so a genuine new login in the same tab shows this again;
// otherwise it survives page refreshes within the same session so it never repeats.
export const POPUP_SESSION_KEY = 'adminPendingPopupShown';

interface Counts { leaves: number; regularizations: number; ot: number; }

export default function PendingReminderPopup() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alreadyShown = false;
    try { alreadyShown = sessionStorage.getItem(POPUP_SESSION_KEY) === '1'; } catch { /* private mode — treat as not shown */ }
    if (alreadyShown) return;

    Promise.all([
      getAllLeaveRequests('pending').then(l => l.length).catch(() => 0),
      getAllRegularizationRequests('pending').then(l => l.length).catch(() => 0),
      getPendingOtCount().catch(() => 0),
    ]).then(([leaves, regularizations, ot]) => {
      // Marked regardless of outcome — a failed or all-zero check must not re-fetch on
      // every refresh this session; it reads the same as "nothing pending" either way.
      try { sessionStorage.setItem(POPUP_SESSION_KEY, '1'); } catch { /* ignore */ }
      if (leaves + regularizations + ot === 0) return;
      setCounts({ leaves, regularizations, ot });
      try {
        new Audio('/sounds/notification.wav').play().catch(() => { /* autoplay blocked — popup still shows */ });
      } catch { /* Audio unsupported — popup still shows */ }
    });
  }, []);

  if (!counts || dismissed) return null;

  const rows: { key: string; href: string; label: string }[] = [];
  if (counts.leaves > 0) {
    rows.push({ key: 'leaves', href: '/leaves', label: `${counts.leaves} leave request${counts.leaves === 1 ? '' : 's'} pending` });
  }
  if (counts.regularizations > 0) {
    rows.push({ key: 'reg', href: '/regularization', label: `${counts.regularizations} regularization${counts.regularizations === 1 ? '' : 's'} pending` });
  }
  if (counts.ot > 0) {
    rows.push({ key: 'ot', href: '/ot-shortage', label: `${counts.ot} OT approval${counts.ot === 1 ? '' : 's'} pending` });
  }

  return (
    <div className="fixed top-4 right-4 z-50 w-[300px] bg-white border border-[#E9E6E2] rounded-2xl shadow-lg p-4">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[13px] font-semibold text-text-primary">Needs your attention</span>
        <button
          className="text-[#A8A29E] hover:text-text-primary text-base leading-none"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map(r => (
          <Link
            key={r.key}
            href={r.href}
            className="text-[13px] text-[#2456C7] hover:underline"
            onClick={() => setDismissed(true)}
          >
            {r.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd admin && npx tsc --noEmit -p tsconfig.json`
Expected: only the same pre-existing `compensation.test.ts` error — no new errors.

- [ ] **Step 3: Commit**

```bash
git add admin/src/components/PendingReminderPopup.tsx
git commit -m "feat(admin): add PendingReminderPopup component"
```

---

### Task 5: Wire into the admin layout and logout

**Files:**
- Modify: `admin/src/app/(admin)/layout.tsx`
- Modify: `admin/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `PendingReminderPopup` (default export) and `POPUP_SESSION_KEY` (named export) from Task 4.

- [ ] **Step 1: Render the popup for admins in the layout**

In `admin/src/app/(admin)/layout.tsx`, add the import alongside the other component imports:

```ts
import PendingReminderPopup from '@/components/PendingReminderPopup';
```

Then change the final `return` block from:

```tsx
  return (
    <AccessProvider value={{ user }}>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <Header onMenuClick={() => setNavOpen(true)} />
          <main className="flex-1 overflow-y-auto px-4 py-4 md:px-[30px] md:py-[26px] pb-12">{children}</main>
        </div>
      </div>
    </AccessProvider>
  );
```

to:

```tsx
  return (
    <AccessProvider value={{ user }}>
      <div className="flex h-screen w-full overflow-hidden bg-background">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <Header onMenuClick={() => setNavOpen(true)} />
          <main className="flex-1 overflow-y-auto px-4 py-4 md:px-[30px] md:py-[26px] pb-12">{children}</main>
        </div>
      </div>
      {user.role === 'admin' && <PendingReminderPopup />}
    </AccessProvider>
  );
```

- [ ] **Step 2: Clear the session flag on logout**

In `admin/src/components/Sidebar.tsx`, add the import:

```ts
import { POPUP_SESSION_KEY } from './PendingReminderPopup';
```

Then change:

```ts
  async function handleLogout() {
    await signOut(auth);
    router.replace('/login');
  }
```

to:

```ts
  async function handleLogout() {
    try { sessionStorage.removeItem(POPUP_SESSION_KEY); } catch { /* private mode etc. — nothing to clear */ }
    await signOut(auth);
    router.replace('/login');
  }
```

- [ ] **Step 3: Build**

Run: `cd admin && npm run build`
Expected: `✓ Compiled successfully`, all pages generated (22 static pages, as before this plan — no new routes).

- [ ] **Step 4: Manual QA**

Run `cd admin && npm run dev`, log into the portal, and check each of the following. Use the Firestore console (or the existing `/leaves` and `/regularization` pages) to arrange the pending counts you need for each check.

1. **Admin, something pending:** log in as a user with `role === 'admin'` while at least one leave/regularization/OT item is pending. The popup appears top-right, chime plays (or fails silently — check the browser console for an autoplay-block warning, which is expected and harmless), and it lists only the non-zero categories with correct counts.
2. **Admin, nothing pending:** clear all three categories (or use an admin account with none pending) and log in again. No popup, no sound.
3. **Dismiss:** click `×` — popup disappears immediately.
4. **Link navigation:** click a category line — navigates to that page (e.g. `/leaves`) and the popup is gone.
5. **No repeat on refresh:** after the popup has appeared once (or been dismissed), refresh the page. It does not reappear this session.
6. **Re-appears after logout → login:** log out (via the Sidebar), log back in. If something is still pending, the popup appears again.
7. **Non-admin never sees it:** log in as `office`/`operations`/`sales` (including one with `tabAccess` to `/leaves`, `/regularization`, and `/ot-shortage`) — confirm the popup never renders, regardless of their `tabAccess`.

- [ ] **Step 5: Commit**

```bash
git add "admin/src/app/(admin)/layout.tsx" admin/src/components/Sidebar.tsx
git commit -m "feat(admin): wire the pending-reminder popup into login and logout"
```
