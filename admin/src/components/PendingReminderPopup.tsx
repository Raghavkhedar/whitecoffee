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
