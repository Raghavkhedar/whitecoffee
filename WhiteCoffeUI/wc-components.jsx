// ═══════════════════════════════════════════════════════════════
// WHITE COFFEE — Design System v2
// Midnight indigo · Electric blue · Space Grotesk + DM Sans
// ═══════════════════════════════════════════════════════════════

// ── Color tokens ─────────────────────────────────────────────
const WC = {
  mid:     '#05091A',
  deep:    '#0D1836',
  navy:    '#1A2F72',
  accent:  '#3B82F6',
  violet:  '#7C3AED',
  indigo:  '#6366F1',
  sky:     '#38BDF8',
  bg:      '#ECEFFE',
  text1:   '#050B20',
  text2:   '#3A4470',
  text3:   '#8591BD',
  border:  'rgba(59,130,246,0.09)',
  success: '#059669',
  warning: '#D97706',
  danger:  '#E11D48',
};

// ── Module gradients + glow ───────────────────────────────────
const MOD_GRAD = {
  attendance:    'linear-gradient(140deg, #1E3A8A 0%, #3B82F6 100%)',
  mtRequest:     'linear-gradient(140deg, #9A3412 0%, #F97316 100%)',
  mtBuy:         'linear-gradient(140deg, #064E3B 0%, #10B981 100%)',
  matTransfer:   'linear-gradient(140deg, #4C1D95 0%, #8B5CF6 100%)',
  toolTransfer:  'linear-gradient(140deg, #164E63 0%, #06B6D4 100%)',
  workProgress:  'linear-gradient(140deg, #78350F 0%, #FBBF24 100%)',
  leave:         'linear-gradient(140deg, #881337 0%, #F43F5E 100%)',
  leaveApproval: 'linear-gradient(140deg, #064E3B 0%, #34D399 100%)',
};
const MOD_GLOW = {
  attendance:    '0 6px 16px rgba(59,130,246,0.30)',
  mtRequest:     '0 6px 16px rgba(249,115,22,0.30)',
  mtBuy:         '0 6px 16px rgba(16,185,129,0.30)',
  matTransfer:   '0 6px 16px rgba(139,92,246,0.30)',
  toolTransfer:  '0 6px 16px rgba(6,182,212,0.30)',
  workProgress:  '0 6px 16px rgba(251,191,36,0.28)',
  leave:         '0 6px 16px rgba(244,63,94,0.30)',
  leaveApproval: '0 6px 16px rgba(52,211,153,0.28)',
};

// ── Style helpers ─────────────────────────────────────────────
function glass(extra = {}) {
  return {
    background: 'rgba(255,255,255,0.86)',
    backdropFilter: 'blur(22px)',
    WebkitBackdropFilter: 'blur(22px)',
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.78)',
    boxShadow: '0 1px 2px rgba(5,9,26,0.04), 0 4px 12px rgba(5,9,26,0.06), 0 12px 32px rgba(5,9,26,0.04)',
    ...extra,
  };
}

const navHdr = {
  background: 'linear-gradient(150deg, #05091A 0%, #0D1836 45%, #1A2F72 100%)',
  position: 'relative',
  overflow: 'hidden',
};

function sg(size, weight = 600, color = WC.text1) {
  return { fontFamily: "'Space Grotesk', sans-serif", fontSize: size, fontWeight: weight, color };
}
function dm(size, weight = 400, color = WC.text2) {
  return { fontFamily: "'DM Sans', sans-serif", fontSize: size, fontWeight: weight, color };
}

// ── Header mesh overlay (div-based, no SVG) ──────────────────
function HdrMesh() {
  return (
    <>
      <div style={{ position: 'absolute', top: '-50%', right: '-20%', width: '80%', paddingBottom: '80%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.28) 0%, transparent 65%)', pointerEvents: 'none', zIndex: 0 }}/>
      <div style={{ position: 'absolute', bottom: '-40%', left: '-25%', width: '75%', paddingBottom: '75%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,58,237,0.16) 0%, transparent 65%)', pointerEvents: 'none', zIndex: 0 }}/>
    </>
  );
}

// ── Background blobs ──────────────────────────────────────────
function Blobs() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      <div style={{ position: 'absolute', top: -70, right: -60, width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.10) 0%, transparent 60%)' }}/>
      <div style={{ position: 'absolute', bottom: 30, left: -70, width: 260, height: 260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(59,130,246,0.09) 0%, transparent 60%)' }}/>
      <div style={{ position: 'absolute', top: '42%', right: '8%', width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,58,237,0.06) 0%, transparent 60%)' }}/>
    </div>
  );
}

// ── NavHeader ─────────────────────────────────────────────────
function NavHeader({ title, sub, onBack }) {
  return (
    <div style={{ ...navHdr, padding: '62px 20px 20px', flexShrink: 0 }}>
      <HdrMesh/>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative', zIndex: 1 }}>
        {onBack && (
          <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 11, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s' }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        )}
        <div>
          <div style={{ ...sg(19, 700, 'white'), letterSpacing: '-0.025em' }}>{title}</div>
          {sub && <div style={{ ...dm(11, 400, 'rgba(160,190,255,0.72)'), marginTop: 1 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

// ── HomeHeader ────────────────────────────────────────────────
function HomeHeader({ name, role, unread = 0, onBell, onLogout }) {
  const h = new Date().getHours();
  const greet = h < 5 ? 'Good night,' : h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,';
  const roleLabel = { operations: 'Operations', office: 'Office', admin: 'Admin' }[role] || role;
  const roleDot   = { operations: '#60A5FA', office: '#A78BFA', admin: '#34D399' }[role] || '#60A5FA';
  return (
    <div style={{ ...navHdr, padding: '62px 20px 22px', flexShrink: 0 }}>
      <HdrMesh/>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
        <div>
          <div style={{ ...dm(12, 400, 'rgba(160,190,255,0.70)'), marginBottom: 2 }}>{greet}</div>
          <div style={{ ...sg(22, 700, 'white'), letterSpacing: '-0.03em', lineHeight: 1.1 }}>{name}</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.09)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 20, padding: '3px 10px', marginTop: 9 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: roleDot }}/>
            <span style={{ ...dm(11, 500, 'white') }}>{roleLabel}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <button onClick={onBell} style={{ background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 12, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', cursor: 'pointer' }}>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
            </button>
            {unread > 0 && <div style={{ position: 'absolute', top: -3, right: -3, background: '#F43F5E', color: 'white', fontSize: 8, fontWeight: 700, borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #05091A' }}>{unread}</div>}
          </div>
          <button onClick={onLogout} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 10, padding: '8px 12px', ...dm(11, 500, 'rgba(160,190,255,0.85)'), cursor: 'pointer' }}>Logout</button>
        </div>
      </div>
    </div>
  );
}

// ── Buttons ───────────────────────────────────────────────────
function PrimaryBtn({ children, onClick, loading, disabled, style: xStyle = {} }) {
  const [p, setP] = React.useState(false);
  return (
    <button onClick={!disabled && !loading ? onClick : undefined}
      onMouseDown={() => setP(true)} onMouseUp={() => setP(false)}
      onTouchStart={() => setP(true)} onTouchEnd={() => setP(false)}
      disabled={disabled || loading}
      style={{ background: disabled ? '#C5CDEA' : 'linear-gradient(130deg, #0D1836 0%, #3B82F6 100%)', color: 'white', border: 'none', borderRadius: 14, padding: '14px 20px', width: '100%', ...sg(14, 600, 'white'), cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: disabled ? 'none' : '0 4px 18px rgba(59,130,246,0.42), 0 1px 4px rgba(59,130,246,0.18)', transform: p ? 'scale(0.975)' : 'scale(1)', transition: 'transform 0.10s ease', letterSpacing: '-0.01em', ...xStyle }}>
      {loading ? <div style={{ width: 17, height: 17, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'wcSpin 0.7s linear infinite' }}/> : children}
    </button>
  );
}
function OutlineBtn({ children, onClick, color, style: xStyle = {} }) {
  const c = color || WC.accent;
  const [p, setP] = React.useState(false);
  return (
    <button onClick={onClick}
      onMouseDown={() => setP(true)} onMouseUp={() => setP(false)}
      onTouchStart={() => setP(true)} onTouchEnd={() => setP(false)}
      style={{ background: 'rgba(255,255,255,0.65)', color: c, border: `1.5px solid ${c}28`, borderRadius: 14, padding: '13px 20px', width: '100%', ...sg(14, 600, c), cursor: 'pointer', transform: p ? 'scale(0.975)' : 'scale(1)', transition: 'transform 0.10s ease', letterSpacing: '-0.01em', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', ...xStyle }}>
      {children}
    </button>
  );
}

// ── Status badge ──────────────────────────────────────────────
const STATUS_CFG = {
  pending:  { bg: '#FEF3C7', fg: '#92400E', label: 'Pending' },
  approved: { bg: '#D1FAE5', fg: '#065F46', label: 'Approved' },
  rejected: { bg: '#FEE2E2', fg: '#9F1239', label: 'Rejected' },
};
function StatusBadge({ status }) {
  const s = STATUS_CFG[status] || { bg: '#EEF2FF', fg: '#4338CA', label: status };
  return <span style={{ background: s.bg, color: s.fg, padding: '3px 10px', borderRadius: 20, ...dm(11, 600, s.fg) }}>{s.label}</span>;
}

// ── Section label ─────────────────────────────────────────────
function SectionLabel({ children }) {
  return <div style={{ ...sg(10, 700, WC.text3), letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 11 }}>{children}</div>;
}

// ── Input field ───────────────────────────────────────────────
function InputField({ label, type = 'text', value, onChange, placeholder, icon }) {
  const [focused, setFocused] = React.useState(false);
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ ...sg(11, 600, focused ? WC.accent : WC.text3), letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 6, transition: 'color 0.18s' }}>{label}</label>
      <div style={{ position: 'relative', border: `1.5px solid ${focused ? WC.accent : WC.border}`, borderRadius: 12, background: focused ? 'rgba(59,130,246,0.03)' : 'rgba(255,255,255,0.96)', transition: 'all 0.18s', boxShadow: focused ? '0 0 0 3.5px rgba(59,130,246,0.10)' : 'none' }}>
        {icon && <div style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: WC.text3 }}>{icon}</div>}
        <input type={type} value={value} onChange={onChange}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholder={placeholder}
          style={{ width: '100%', padding: `12px 13px 12px ${icon ? '40px' : '13px'}`, border: 'none', background: 'transparent', outline: 'none', ...dm(14, 400, WC.text1), boxSizing: 'border-box' }}/>
      </div>
    </div>
  );
}

// ── Module icons ──────────────────────────────────────────────
const WCIcons = {
  attendance:    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>,
  mtRequest:     <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94z"/></svg>,
  mtBuy:         <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>,
  matTransfer:   <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>,
  toolTransfer:  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>,
  workProgress:  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  leave:         <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  leaveApproval: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
};

// ── Module card ───────────────────────────────────────────────
function ModuleCard({ id, title, sub, onClick, layout = 'grid', stagger = 0 }) {
  const [p, setP] = React.useState(false);
  const icon = WCIcons[id] || WCIcons.attendance;
  const grad = MOD_GRAD[id] || MOD_GRAD.attendance;
  const glow = MOD_GLOW[id] || MOD_GLOW.attendance;
  const handlers = { onClick, onMouseDown: () => setP(true), onMouseUp: () => setP(false), onTouchStart: () => setP(true), onTouchEnd: () => setP(false) };

  if (layout === 'list') {
    return (
      <div {...handlers} className={`wc-s${stagger}`}
        style={{ ...glass({ borderRadius: 16 }), display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', marginBottom: 9, cursor: 'pointer', transform: p ? 'scale(0.99)' : 'scale(1)', transition: 'transform 0.12s ease' }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: grad, boxShadow: glow, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...sg(13, 600), letterSpacing: '-0.01em' }}>{title}</div>
          <div style={{ ...dm(11, 400, WC.text3), marginTop: 2, lineHeight: 1.4 }}>{sub}</div>
        </div>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: WC.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: WC.text3, flexShrink: 0 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </div>
      </div>
    );
  }

  return (
    <div {...handlers} className={`wc-s${stagger}`}
      style={{ ...glass({ borderRadius: 18 }), padding: '16px 14px 15px', cursor: 'pointer', transform: p ? 'scale(0.96)' : 'scale(1)', transition: 'transform 0.12s ease', display: 'flex', flexDirection: 'column', gap: 13, minHeight: 110 }}>
      <div style={{ width: 44, height: 44, borderRadius: 13, background: grad, boxShadow: glow, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>{icon}</div>
      <div>
        <div style={{ ...sg(12, 600), letterSpacing: '-0.01em', lineHeight: 1.3 }}>{title}</div>
        <div style={{ ...dm(10, 400, WC.text3), marginTop: 2, lineHeight: 1.45 }}>{sub}</div>
      </div>
    </div>
  );
}

// ── Timeline item ─────────────────────────────────────────────
const TL = {
  home_in:    { label: 'Home Check-in',    color: '#10B981' },
  home_out:   { label: 'Home Check-out',   color: '#F43F5E' },
  site_in:    { label: 'Site Check-in',    color: '#3B82F6' },
  site_out:   { label: 'Site Check-out',   color: '#7C3AED' },
  market_in:  { label: 'Market In',        color: '#F97316' },
  market_out: { label: 'Market Out',       color: '#FBBF24' },
  office_in:  { label: 'Office Check-in',  color: '#10B981' },
  office_out: { label: 'Office Check-out', color: '#F43F5E' },
};
function TimelineItem({ type, time, place, last = false }) {
  const cfg = TL[type] || { label: type, color: WC.text3 };
  return (
    <div style={{ display: 'flex', gap: 12, paddingBottom: last ? 0 : 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 26 }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: cfg.color + '15', border: `2px solid ${cfg.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.color }}/>
        </div>
        {!last && <div style={{ width: 2, flex: 1, background: WC.border, marginTop: 3 }}/>}
      </div>
      <div style={{ paddingTop: 2, flex: 1 }}>
        <div style={{ ...sg(12, 600) }}>{cfg.label}</div>
        {place && <div style={{ ...dm(11, 400, WC.text3), marginTop: 1 }}>{place}</div>}
        <div style={{ ...dm(11, 400, WC.text3), marginTop: 1 }}>{time}</div>
      </div>
    </div>
  );
}

// ── Notification item ─────────────────────────────────────────
const NOTIF_C = { urgent: '#F43F5E', leave_update: '#3B82F6', work_reminder: '#F59E0B', general: '#7C3AED' };
function NotifItem({ title, body, type, read, time }) {
  const color = NOTIF_C[type] || WC.text3;
  return (
    <div style={{ ...glass({ borderRadius: 14 }), padding: '13px 15px', marginBottom: 9, borderLeft: `3px solid ${read ? 'transparent' : color}`, background: read ? 'rgba(255,255,255,0.60)' : 'rgba(255,255,255,0.90)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ ...sg(12, read ? 500 : 600) }}>{title}</div>
          <div style={{ ...dm(11, 400, WC.text3), marginTop: 3, lineHeight: 1.5 }}>{body}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
          <div style={{ ...dm(9, 400, WC.text3) }}>{time}</div>
          {!read && <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }}/>}
        </div>
      </div>
    </div>
  );
}

// ── Leave card ────────────────────────────────────────────────
function LeaveCard({ type, from, to, days, status, reason }) {
  return (
    <div style={{ ...glass({ borderRadius: 16 }), padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ ...sg(13, 600) }}>{type}</div>
          <div style={{ ...dm(11, 400, WC.text3), marginTop: 2 }}>{from} → {to}</div>
        </div>
        <StatusBadge status={status}/>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ ...dm(11, 400), flex: 1, paddingRight: 10, lineHeight: 1.5 }}>{reason}</div>
        <div style={{ background: '#EEF2FF', borderRadius: 8, padding: '3px 9px', ...sg(11, 600, WC.accent), flexShrink: 0 }}>{days}d</div>
      </div>
    </div>
  );
}

Object.assign(window, {
  WC, MOD_GRAD, MOD_GLOW, glass, navHdr, sg, dm,
  HdrMesh, Blobs,
  NavHeader, HomeHeader, PrimaryBtn, OutlineBtn,
  StatusBadge, SectionLabel, InputField,
  WCIcons, ModuleCard, TimelineItem, NotifItem, LeaveCard,
});
