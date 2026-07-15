'use client';
import { usePathname } from 'next/navigation';
import { useAccess } from './AccessContext';
import { allowedPaths } from '@/lib/portalAccess';
import Icon from './Icon';

const TITLES: Record<string, { title: string; subtitle: string }> = {
  '/dashboard':           { title: 'Dashboard',          subtitle: 'Live overview of your team today' },
  '/working-hours-shortage-excess':  { title: 'Working Hours-Shortage/Excess',  subtitle: 'Expected vs actual working hours' },
  '/users':               { title: 'Employees',           subtitle: 'Manage roles, salary rates and leave balances' },
  '/leaves':              { title: 'Leave Requests',      subtitle: 'Review and approve time-off requests' },
  '/regularization':      { title: 'Regularization',      subtitle: 'Review attendance correction requests' },
  '/attendance':          { title: 'Attendance',          subtitle: 'Daily status & planned shifts' },
  '/ot-shortage':         { title: 'OT & Shortage',       subtitle: 'Review overtime and track shortage for operations' },
  '/ot-settlements':      { title: 'OT Settlements',      subtitle: 'Settle & lock monthly OT/shortage/WO into payroll' },
  '/manpower-utilisation-input': { title: 'Manpower Utilisation Input', subtitle: 'Assign site codes to operations check-ins' },
  '/access':              { title: 'Access Control',       subtitle: 'Grant portal tabs per employee' },
  '/conveyance':          { title: 'Conveyance',          subtitle: 'Monthly travel reimbursements' },
  '/submissions':         { title: 'Submissions',         subtitle: 'Material, tools, work progress & conveyance' },
  '/notifications':       { title: 'Notifications',       subtitle: 'Send push alerts to your team' },
};

function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function Header() {
  const pathname = usePathname();
  const { user } = useAccess();
  const name = user?.name || 'Admin';
  // Accurate role label: admins say "Administrator"; scoped staff show their tab count.
  const grantedCount = allowedPaths(user).length;
  const roleLabel = user?.role === 'admin'
    ? 'Administrator'
    : (grantedCount > 0 ? `Scoped access · ${grantedCount} tab${grantedCount === 1 ? '' : 's'}` : 'Staff');

  const match = Object.keys(TITLES).find(k => pathname === k || pathname.startsWith(k + '/'));
  const meta  = match ? TITLES[match] : { title: 'WhiteCoffee', subtitle: 'Admin Portal' };
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <header className="flex items-center justify-between h-16 flex-shrink-0 px-[30px] border-b border-[#ECE9E5] bg-[rgba(250,249,247,0.82)] backdrop-blur-md sticky top-0 z-30">
      <div>
        <div className="text-[18px] font-semibold tracking-tight text-text-primary leading-[1.15]">{meta.title}</div>
        <div className="text-[12.5px] text-[#9A938C] mt-px">{meta.subtitle}</div>
      </div>
      <div className="flex items-center gap-[14px]">
        <div className="flex items-center gap-2 h-9 px-[13px] border border-border rounded-[9px] bg-white text-[12.5px] text-[#6B635C] font-medium">
          <span className="text-[#B4ADA5] flex"><Icon name="calendar" size={15} /></span>{today}
        </div>
        <button className="relative w-9 h-9 flex items-center justify-center border border-border rounded-[9px] bg-white text-[#6B635C] hover:bg-[#F5F2EE] transition-colors">
          <Icon name="bell" size={17} />
          <span className="absolute top-2 right-[9px] w-[7px] h-[7px] rounded-full bg-[#E0602E] border-[1.5px] border-white" />
        </button>
        <div className="w-px h-[26px] bg-border" />
        <div className="flex items-center gap-2.5">
          <div className="w-[34px] h-[34px] rounded-full bg-primary text-white flex items-center justify-center text-[12.5px] font-semibold font-mono">{initials(name)}</div>
          <div className="leading-[1.2]">
            <div className="text-[13px] font-semibold text-[#2A241F]">{name}</div>
            <div className="text-[11px] text-[#9A938C]">{roleLabel}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
