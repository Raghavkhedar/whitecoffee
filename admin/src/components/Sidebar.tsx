'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { getAllLeaveRequests } from '@/lib/firestore';
import { TABS, allowedPaths, type TabDef } from '@/lib/portalAccess';
import { useAccess } from './AccessContext';
import Icon from './Icon';

export default function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { user } = useAccess();
  const [pending, setPending] = useState<number | null>(null);

  // Build the visible nav from the single TABS registry, filtered to what this
  // user may access, then grouped (preserving TABS order). Empty groups drop out.
  const navGroups = useMemo(() => {
    const allowed = new Set(allowedPaths(user));
    const groups: { label?: string; items: TabDef[] }[] = [];
    for (const tab of TABS) {
      if (!allowed.has(tab.path)) continue;
      let g = groups.find(x => x.label === tab.group);
      if (!g) { g = { label: tab.group, items: [] }; groups.push(g); }
      g.items.push(tab);
    }
    return groups;
  }, [user]);

  const canSeeLeaves = useMemo(() => allowedPaths(user).includes('/leaves'), [user]);

  // Only fetch the pending-leaves badge for users who can see Leaves — a tagged
  // manager without that tab would otherwise trigger a permission-denied read.
  useEffect(() => {
    if (!canSeeLeaves) { setPending(null); return; }
    getAllLeaveRequests('pending')
      .then(l => setPending(l.length))
      .catch(() => setPending(null));
  }, [canSeeLeaves]);

  async function handleLogout() {
    await signOut(auth);
    router.replace('/login');
  }

  return (
    <aside className="w-[248px] flex-shrink-0 bg-sidebar flex flex-col h-screen">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-white/[0.07]">
        <div className="w-9 h-9 rounded-[10px] bg-primary text-white flex items-center justify-center font-semibold text-[13px] font-mono">WC</div>
        <div className="leading-tight">
          <div className="text-[14.5px] font-semibold text-white tracking-tight">WhiteCoffee</div>
          <div className="text-[11px] text-[#8A93A0] mt-0.5">Admin Portal</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {navGroups.map((group, gi) => (
          <div key={group.label ?? gi} className={gi > 0 ? 'mt-5' : ''}>
            {group.label && (
              <div className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[#6B7480]">{group.label}</div>
            )}
            {group.items.map(item => {
              const active = pathname === item.path || pathname.startsWith(item.path + '/');
              const badge  = item.badgeKey === 'pending' && pending ? pending : null;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  className={`flex items-center gap-3 px-3 py-[8.5px] rounded-[9px] text-[13.5px] mb-0.5 transition-colors ${
                    active
                      ? 'bg-white/[0.08] text-white font-semibold'
                      : 'text-[#9AA3AE] font-medium hover:bg-white/[0.05] hover:text-[#F0F2F5]'
                  }`}
                >
                  <span className="flex" style={{ color: active ? '#4D90D9' : undefined }}>
                    <Icon name={item.icon} size={17.5} />
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {badge != null && (
                    <span className="font-mono text-[11px] font-semibold bg-primary text-white rounded-[7px] px-[7px] leading-[1.55]">{badge}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Logout */}
      <div className="px-3 py-3 border-t border-white/[0.07]">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-[8.5px] rounded-[9px] text-[13.5px] font-medium text-[#9AA3AE] hover:bg-white/[0.05] hover:text-[#F0F2F5] transition-colors"
        >
          <span className="flex"><Icon name="logout" size={16} /></span>
          Sign out
        </button>
      </div>
    </aside>
  );
}
