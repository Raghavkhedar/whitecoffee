// Lightweight inline line-icon set (stroke style matched to the design prototype).
import type { CSSProperties } from 'react';

export type IconName =
  | 'grid' | 'users' | 'userCircle' | 'leave' | 'clock' | 'calendar'
  | 'pin' | 'car' | 'doc' | 'bell' | 'logout' | 'search' | 'plus'
  | 'chevron' | 'chevronLeft' | 'chevronRight' | 'more' | 'download' | 'list';

const PATHS: Record<IconName, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="3" width="7" height="7" rx="1.6" /><rect x="14" y="14" width="7" height="7" rx="1.6" /><rect x="3" y="14" width="7" height="7" rx="1.6" /></>,
  users: <><path d="M16 21v-1.8a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V21" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-1.8a4 4 0 0 0-3-3.86" /><path d="M16 3.2a4 4 0 0 1 0 7.6" /></>,
  userCircle: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="10" r="3" /><path d="M6.2 18.5a6 6 0 0 1 11.6 0" /></>,
  leave: <><rect x="3" y="4.5" width="18" height="17" rx="1.6" /><path d="M16 2.5v4" /><path d="M8 2.5v4" /><path d="M3 10h18" /><path d="M8.5 15.5l2.2 2.2 4.3-4.3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5l3.2 1.9" /></>,
  calendar: <><rect x="3" y="4.5" width="18" height="17" rx="1.6" /><path d="M16 2.5v4" /><path d="M8 2.5v4" /><path d="M3 10h18" /></>,
  pin: <><path d="M20 10.5c0 5.5-8 11-8 11s-8-5.5-8-11a8 8 0 0 1 16 0z" /><circle cx="12" cy="10.2" r="2.8" /></>,
  car: <><path d="M5 17.5H3.2v-4.8l1.9-4.7h13.8l1.9 4.7v4.8H19" /><circle cx="7.4" cy="17.5" r="1.6" /><circle cx="16.6" cy="17.5" r="1.6" /><path d="M5 12.7h14" /></>,
  doc: <><path d="M14 2.5H6.5a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8z" /><path d="M14 2.5V8h5.5" /><path d="M9 13.5h6" /><path d="M9 17h6" /></>,
  bell: <><path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.6 8.5-2.6 8.5h17.2S18 15 18 8.5z" /><path d="M13.7 20.5a2 2 0 0 1-3.4 0" /></>,
  logout: <><path d="M9 21H5.5a2 2 0 0 1-2-2v-14a2 2 0 0 1 2-2H9" /><path d="M16 16.5l4.5-4.5L16 7.5" /><path d="M20.5 12H9" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.2-4.2" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  more: <><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></>,
  download: <><path d="M12 4v12" /><path d="M6.5 11l5.5 5 5.5-5" /><path d="M4 20h16" /></>,
  list: <><path d="M8 6h12" /><path d="M8 12h12" /><path d="M8 18h12" /><path d="M3.5 6h.01" /><path d="M3.5 12h.01" /><path d="M3.5 18h.01" /></>,
};

export default function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      style={style}
    >
      {PATHS[name]}
    </svg>
  );
}
