'use client';
import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { getAllLeaveRequests, getAllRegularizationRequests, getPendingOtCount } from '@/lib/firestore';

export const POPUP_SESSION_KEY = 'adminPendingPopupShown';

interface Counts { leaves: number; regularizations: number; ot: number; }

export default function HeaderNotificationBell() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const total = counts ? counts.leaves + counts.regularizations + counts.ot : 0;

  useEffect(() => {
    let active = true;
    Promise.all([
      getAllLeaveRequests('pending').then(l => l.length).catch(() => 0),
      getAllRegularizationRequests('pending').then(l => l.length).catch(() => 0),
      getPendingOtCount().catch(() => 0),
    ]).then(([leaves, regularizations, ot]) => {
      if (!active) return;
      setCounts({ leaves, regularizations, ot });
      
      const totalPending = leaves + regularizations + ot;
      if (totalPending > 0) {
        let alreadyShown = false;
        try { alreadyShown = sessionStorage.getItem(POPUP_SESSION_KEY) === '1'; } catch { /* ignore */ }
        
        if (!alreadyShown) {
          try { sessionStorage.setItem(POPUP_SESSION_KEY, '1'); } catch { /* ignore */ }
          setIsOpen(true); // Auto-open on first login
          
          // Audio logic
          try {
            const audio = new Audio('/sounds/notification.wav');
            const playPromise = audio.play();
            if (playPromise !== undefined) {
              playPromise.catch((err) => {
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
            }
          } catch { /* ignore */ }
        }
      }
    });
    return () => { active = false; };
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (!counts) return null; // loading

  const rows: { key: string; href: string; label: string }[] = [];
  if (counts.leaves > 0) rows.push({ key: 'leaves', href: '/leaves', label: `${counts.leaves} leave request${counts.leaves === 1 ? '' : 's'} pending` });
  if (counts.regularizations > 0) rows.push({ key: 'reg', href: '/regularization', label: `${counts.regularizations} regularization${counts.regularizations === 1 ? '' : 's'} pending` });
  if (counts.ot > 0) rows.push({ key: 'ot', href: '/ot-shortage', label: `${counts.ot} OT approval${counts.ot === 1 ? '' : 's'} pending` });

  return (
    <div className="relative flex items-center" ref={dropdownRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={`relative p-2 rounded-full transition-colors focus:outline-none ${isOpen ? 'bg-[#F5F2EE] text-[#2A241F]' : 'text-[#6B635C] hover:bg-[#F5F2EE] hover:text-[#2A241F]'}`}
        aria-label="Notifications"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-[18px] h-[18px]">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {total > 0 && (
          <span className="absolute top-[5px] right-[7px] flex h-[7px] w-[7px]">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-[7px] w-[7px] bg-red-500"></span>
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-3 w-[340px] bg-white border border-[#E9E6E2] rounded-xl shadow-2xl overflow-hidden z-50 transform origin-top-right transition-all">
          <div className="bg-[#FAFAFA] px-4 py-3 border-b border-[#E9E6E2] flex items-center justify-between">
            <span className="text-[14px] font-semibold text-text-primary">Notifications</span>
            {total > 0 && (
              <span className="text-[11px] font-medium bg-[#F3F4F6] text-[#4B5563] px-2 py-0.5 rounded-full">
                {total} New
              </span>
            )}
          </div>
          
          <div className="flex flex-col p-1.5 max-h-[400px] overflow-y-auto">
            {rows.length === 0 ? (
              <div className="px-4 py-6 text-center text-[13px] text-text-secondary">
                You're all caught up!
              </div>
            ) : (
              rows.map(r => (
                <Link
                  key={r.key}
                  href={r.href}
                  className="flex items-start px-3 py-3 text-[13.5px] font-medium text-[#1F2937] hover:bg-[#F3F4F6] rounded-lg transition-colors group"
                  onClick={() => setIsOpen(false)}
                >
                  <div className="w-2 h-2 rounded-full bg-[#3B82F6] mt-1.5 mr-3 flex-shrink-0" />
                  <span className="group-hover:text-[#2456C7] transition-colors">{r.label}</span>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
