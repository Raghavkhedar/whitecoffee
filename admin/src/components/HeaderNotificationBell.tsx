'use client';
import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { getAllLeaveRequests, getAllRegularizationRequests, getPendingOtCount } from '@/lib/firestore';

export const POPUP_SESSION_KEY = 'adminPendingPopupShown';

interface Counts { leaves: number; regularizations: number; ot: number; }

export default function HeaderNotificationBell() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const total = counts ? counts.leaves + counts.regularizations + counts.ot : 0;

  // `document.body` (for the portal below) only exists client-side; this also keeps the
  // static export's build-time render from touching it.
  useEffect(() => { setMounted(true); }, []);

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
          setShowModal(true); // Show center modal on first load
          
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
    <>
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

      {mounted && showModal && total > 0 && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-[400px] max-w-[90vw] overflow-hidden">
            <div className="bg-[#FFFBEB] px-6 py-4 border-b border-[#FDE68A] flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#FEF3C7] flex items-center justify-center flex-shrink-0 text-[#D97706]">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path fillRule="evenodd" d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.205A8.217 8.217 0 005.25 9.75V9zm4.502 8.9a2.25 2.25 0 104.496 0 25.057 25.057 0 01-4.496 0z" clipRule="evenodd" />
                </svg>
              </div>
              <div>
                <h3 className="text-[17px] font-semibold text-[#92400E]">Attention Required</h3>
                <p className="text-[13px] text-[#B45309]">You have pending requests to review.</p>
              </div>
            </div>
            
            <div className="p-4 flex flex-col gap-2">
              {rows.map(r => (
                <Link
                  key={r.key}
                  href={r.href}
                  className="flex items-center justify-between px-4 py-3.5 bg-[#F8FAFC] border border-[#E2E8F0] hover:border-[#93C5FD] hover:bg-[#EFF6FF] rounded-xl transition-colors group"
                  onClick={() => setShowModal(false)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#3B82F6]" />
                    <span className="text-[14px] font-medium text-[#1E293B] group-hover:text-[#1D4ED8]">{r.label}</span>
                  </div>
                  <span className="text-[#94A3B8] group-hover:text-[#3B82F6]">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                    </svg>
                  </span>
                </Link>
              ))}
            </div>
            
            <div className="px-4 py-3 border-t border-[#E9E6E2] bg-[#FAFAFA] flex justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-5 py-2 bg-white border border-[#D6D3D1] hover:bg-[#F5F5F4] text-[#44403C] text-[14px] font-medium rounded-lg transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
