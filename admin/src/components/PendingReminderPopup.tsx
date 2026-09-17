'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAllLeaveRequests, getAllRegularizationRequests, getPendingOtCount } from '@/lib/firestore';

export const POPUP_SESSION_KEY = 'adminPendingPopupShown';

interface Counts { leaves: number; regularizations: number; ot: number; }

const BellIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-[#F59E0B]">
    <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.205A8.217 8.217 0 005.25 9.75V9zm4.502 8.9a2.25 2.25 0 104.496 0 25.057 25.057 0 01-4.496 0z" clipRule="evenodd" />
  </svg>
);

export default function PendingReminderPopup() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let alreadyShown = false;
    try { alreadyShown = sessionStorage.getItem(POPUP_SESSION_KEY) === '1'; } catch { /* ignore */ }
    if (alreadyShown) return;

    Promise.all([
      getAllLeaveRequests('pending').then(l => l.length).catch(() => 0),
      getAllRegularizationRequests('pending').then(l => l.length).catch(() => 0),
      getPendingOtCount().catch(() => 0),
    ]).then(([leaves, regularizations, ot]) => {
      try { sessionStorage.setItem(POPUP_SESSION_KEY, '1'); } catch { /* ignore */ }
      if (leaves + regularizations + ot === 0) return;
      
      setCounts({ leaves, regularizations, ot });
      // Small delay so the transition triggers after initial render
      setTimeout(() => setMounted(true), 50);

      // Audio handling: browsers strictly block autoplay on page load until the user interacts.
      // If it fails with NotAllowedError, we queue it up to play on their very first click/tap.
      try {
        const audio = new Audio('/sounds/notification.wav');
        audio.play().catch((err) => {
          if (err.name === 'NotAllowedError') {
            const playOnInteract = () => {
              audio.play().catch(() => {});
              window.removeEventListener('pointerdown', playOnInteract);
              window.removeEventListener('keydown', playOnInteract);
            };
            window.addEventListener('pointerdown', playOnInteract, { once: true });
            window.addEventListener('keydown', playOnInteract, { once: true });
          }
        });
      } catch { /* Audio unsupported */ }
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
    <div 
      className={`fixed top-6 right-6 z-50 w-[360px] bg-white border border-[#E9E6E2] rounded-xl shadow-2xl overflow-hidden transition-all duration-500 ease-out transform ${mounted ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0'}`}
    >
      <div className="bg-[#FFFBEB] px-5 py-3 border-b border-[#FDE68A] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <BellIcon />
          <span className="text-[15px] font-semibold text-[#92400E]">Needs Your Attention</span>
        </div>
        <button
          className="text-[#B45309] hover:text-[#78350F] text-2xl leading-none transition-colors pb-1"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
      <div className="flex flex-col p-2">
        {rows.map(r => (
          <Link
            key={r.key}
            href={r.href}
            className="flex items-center px-4 py-3 text-[14px] font-medium text-[#2456C7] hover:bg-[#F8FAFC] rounded-lg transition-colors"
            onClick={() => setDismissed(true)}
          >
            <div className="w-2 h-2 rounded-full bg-[#3B82F6] mr-3" />
            {r.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
