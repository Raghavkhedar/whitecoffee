// ═══════════════════════════════════════════════════════════════
// WHITE COFFEE — Screen Components
// ═══════════════════════════════════════════════════════════════

// ── Module config ─────────────────────────────────────────────
const MODULES = [
  { id: 'attendance',   title: 'Attendance',      sub: 'Daily check-in / out',      color: '#1D4ED8', bg: '#DBEAFE', roles: ['operations','office','admin'] },
  { id: 'mtRequest',    title: 'M&T Request',     sub: 'Request materials & tools', color: '#EA580C', bg: '#FFEDD5', roles: ['operations'] },
  { id: 'mtBuy',        title: 'M&T Buy',         sub: 'Log site purchases',         color: '#16A34A', bg: '#DCFCE7', roles: ['operations','office','admin'] },
  { id: 'matTransfer',  title: 'Material Tr.',    sub: 'Transfer materials',         color: '#7C3AED', bg: '#EDE9FE', roles: ['operations','office','admin'] },
  { id: 'toolTransfer', title: 'Tool Transfer',   sub: 'Log tool movements',         color: '#0891B2', bg: '#CFFAFE', roles: ['operations','office','admin'] },
  { id: 'workProgress', title: 'Work Progress',   sub: 'Daily progress report',      color: '#CA8A04', bg: '#FEF9C3', roles: ['operations'] },
  { id: 'leave',        title: 'Leave',           sub: 'Apply & track leave',        color: '#E11D48', bg: '#FFE4E6', roles: ['operations','office','admin'] },
  { id: 'leaveApproval',title: 'Leave Approvals', sub: 'Review pending requests',    color: '#059669', bg: '#D1FAE5', roles: ['admin'] },
];

// ── Demo data ─────────────────────────────────────────────────
const DEMO_NOTIFS = [
  { id: 1, title: 'Leave Approved', body: 'Your casual leave for Jun 20 has been approved by Admin.', type: 'leave_update', read: false, time: '2h ago' },
  { id: 2, title: 'Work Progress Reminder', body: 'Please submit your work progress report before 6 PM today.', type: 'work_reminder', read: false, time: '5h ago' },
  { id: 3, title: 'System Maintenance', body: 'Scheduled maintenance tonight 11 PM – 1 AM.', type: 'general', read: true, time: 'Yesterday' },
  { id: 4, title: 'Urgent: Safety Alert', body: 'Reminder: Wear PPE at all times on Gurugaon site.', type: 'urgent', read: true, time: '2d ago' },
];

const DEMO_LEAVES = [
  { id: 1, type: 'Casual Leave',  from: '20 Jun', to: '20 Jun', days: 1, status: 'approved', reason: 'Personal errand' },
  { id: 2, type: 'Sick Leave',    from: '14 Jun', to: '15 Jun', days: 2, status: 'pending',  reason: 'Fever and flu' },
  { id: 3, type: 'Annual Leave',  from: '28 May', to: '1 Jun',  days: 5, status: 'rejected', reason: 'Family vacation' },
];

const ROLE_NAMES = { operations: 'Arjun Sharma', office: 'Priya Mehta', admin: 'Rajesh Kumar' };

// ── Login screen ──────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = React.useState('');
  const [pass, setPass]   = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [err, setErr]     = React.useState('');

  const handleLogin = () => {
    if (!email || !pass) { setErr('Please fill in all fields.'); return; }
    setErr(''); setLoading(true);
    setTimeout(() => { setLoading(false); onLogin(); }, 1500);
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: WC.bg, display: 'flex', flexDirection: 'column' }}>
      {/* Hero */}
      <div style={{ ...navHdr, padding: '68px 28px 58px', flexShrink: 0, position: 'relative' }}>
        <HdrMesh/>
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Logo with pulse rings */}
          <div style={{ position: 'relative', width: 82, height: 82, marginBottom: 26 }}>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 130, height: 130, borderRadius: '50%', border: '1px solid rgba(59,130,246,0.15)', animation: 'wcPulseRing 3.2s ease-in-out infinite' }}/>
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 108, height: 108, borderRadius: '50%', border: '1px solid rgba(59,130,246,0.22)', animation: 'wcPulseRing 3.2s ease-in-out 0.8s infinite' }}/>
            <div style={{ width: 82, height: 82, borderRadius: 26, background: 'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(59,130,246,0.14) 100%)', border: '1px solid rgba(255,255,255,0.24)', boxShadow: '0 8px 32px rgba(59,130,246,0.22), inset 0 1px 0 rgba(255,255,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'wcFloat 3.5s ease-in-out infinite' }}>
              <span style={{ ...sg(28, 700, 'white'), letterSpacing: '-0.02em' }}>WC</span>
            </div>
          </div>
          <div style={{ ...sg(28, 700, 'white'), letterSpacing: '-0.035em' }}>White Coffee</div>
          <div style={{ ...dm(12, 400, 'rgba(160,190,255,0.70)'), marginTop: 7, textAlign: 'center', lineHeight: 1.5 }}>Senken Engineering<br/>Field Operations Platform</div>
        </div>
      </div>

      {/* Form card */}
      <div style={{ padding: '0 18px 40px', marginTop: -24, flex: 1 }}>
        <div style={{ ...glass({ borderRadius: 22 }), padding: '28px 20px 24px' }}>
          <div style={{ ...sg(20, 700), letterSpacing: '-0.025em', marginBottom: 3 }}>Welcome back</div>
          <div style={{ ...dm(12, 400, WC.text3), marginBottom: 24 }}>Sign in with your company credentials</div>

          <InputField label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@senken.in"
            icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>}/>
          <InputField label="Password" type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="••••••••"
            icon={<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>}/>

          {err && <div style={{ ...dm(11, 400, '#F43F5E'), marginBottom: 12 }}>{err}</div>}
          <PrimaryBtn onClick={handleLogin} loading={loading}>Sign In →</PrimaryBtn>
        </div>
        <div style={{ ...dm(11, 400, WC.text3), textAlign: 'center', marginTop: 20 }}>Senken Engineering © 2025</div>
      </div>
    </div>
  );
}

// ── Home screen ───────────────────────────────────────────────
function HomeScreen({ role, layout, onNavigate }) {
  const mods = MODULES.filter(m => m.roles.includes(role));

  const handleMod = (mod) => {
    if (mod.id === 'attendance') onNavigate(role === 'operations' ? 'attendance' : 'office_att');
    else if (mod.id === 'leave' || mod.id === 'leaveApproval') onNavigate('leave');
    else if (mod.id === 'mtBuy')         onNavigate('mt_buy');
    else if (mod.id === 'mtRequest')     onNavigate('mt_request');
    else if (mod.id === 'matTransfer')   onNavigate('mat_transfer');
    else if (mod.id === 'toolTransfer')  onNavigate('tool_transfer');
    else if (mod.id === 'workProgress')  onNavigate('work_progress');
    else if (mod.id === 'leaveApproval') onNavigate('leave');
  };

  const now   = new Date();
  const dayName  = now.toLocaleDateString('en-IN', { weekday: 'long' });
  const dayNum   = now.getDate();
  const monthYear = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: WC.bg }}>
      <HomeHeader name={ROLE_NAMES[role] || 'User'} role={role} unread={2}
        onBell={() => onNavigate('notifications')}
        onLogout={() => onNavigate('login', 'back')}/>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 15px 44px', position: 'relative' }}>
        <Blobs/>
        <div style={{ position: 'relative', zIndex: 1 }}>

          {/* Today card */}
          <div style={{ ...glass({ borderRadius: 18, boxShadow: '0 2px 8px rgba(5,9,26,0.05), 0 8px 24px rgba(5,9,26,0.06)' }), padding: '15px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} className="wc-s1">
            <div>
              <div style={{ ...dm(11, 400, WC.text3) }}>{dayName}</div>
              <div style={{ ...sg(28, 700, WC.text1), letterSpacing: '-0.04em', lineHeight: 1 }}>{dayNum}</div>
              <div style={{ ...dm(12, 500, WC.text2), marginTop: 3 }}>{monthYear}</div>
            </div>
            <div style={{ width: 1, height: 44, background: WC.border }}/>
            <div style={{ textAlign: 'right' }}>
              <div style={{ ...dm(10, 400, WC.text3), marginBottom: 5 }}>Attendance</div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(244,63,94,0.08)', borderRadius: 20, padding: '4px 10px' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F43F5E', animation: 'wcPulse 2s ease-in-out infinite' }}/>
                <span style={{ ...sg(11, 600, '#F43F5E') }}>Not checked in</span>
              </div>
            </div>
          </div>

          <SectionLabel>Quick Actions</SectionLabel>

          <div key={`${role}-${layout}`}>
            {layout === 'grid' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                {mods.map((m, i) => <ModuleCard key={m.id} {...m} onClick={() => handleMod(m)} layout="grid" stagger={Math.min(i+1,6)}/>)}
              </div>
            ) : (
              <div>
                {mods.map((m, i) => <ModuleCard key={m.id} {...m} onClick={() => handleMod(m)} layout="list" stagger={Math.min(i+1,6)}/>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Attendance screen (Operations) ────────────────────────────
function AttendanceScreen({ onBack }) {
  const [state, setState]       = React.useState('no_record');
  const [events, setEvents]     = React.useState([]);
  const [dialog, setDialog]     = React.useState(null); // 'site' | 'market'
  const [siteName, setSiteName] = React.useState('');
  const [siteId, setSiteId]     = React.useState('');
  const [mktName, setMktName]   = React.useState('');
  const [loading, setLoading]   = React.useState(false);

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const now = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  const addEvent = (type, place = '') => setEvents(prev => [...prev, { type, time: now(), place }]);

  const doAction = (action) => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      switch (action) {
        case 'home_in':    addEvent('home_in');                               setState('home_in');    break;
        case 'site_in':    addEvent('site_in', siteName || 'Site');           setState('site_in');    setDialog(null); setSiteName(''); setSiteId(''); break;
        case 'market_in':  addEvent('market_in', mktName || 'Market');        setState('market_in'); setDialog(null); setMktName(''); break;
        case 'site_out':   addEvent('site_out');                              setState('home_in');   break;
        case 'market_out': addEvent('market_out');                            setState('home_in');   break;
        case 'home_out':   addEvent('home_out');                              setState('day_complete'); break;
      }
    }, 900);
  };

  const lastSite = events.filter(e => e.type === 'site_in').slice(-1)[0];
  const lastMkt  = events.filter(e => e.type === 'market_in').slice(-1)[0];

  const STATUS_INFO = {
    no_record:    { label: 'Not Checked In',        sub: 'Start your work day',             dot: '#9CA3AF', color: WC.text2 },
    home_in:      { label: 'Working from Home',     sub: 'Checked in · GPS captured',       dot: '#16A34A', color: '#15803D' },
    site_in:      { label: lastSite ? `At Site — ${lastSite.place}` : 'At Site', sub: 'On-site · GPS captured', dot: WC.accent, color: WC.accent },
    market_in:    { label: lastMkt  ? `At Market — ${lastMkt.place}` : 'At Market', sub: 'Market visit · GPS captured', dot: '#EA580C', color: '#C2410C' },
    day_complete: { label: 'Day Complete',           sub: 'Great work today!',              dot: '#059669', color: '#047857' },
  };
  const si = STATUS_INFO[state];

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: WC.bg }}>
      <NavHeader title="Attendance" sub={today} onBack={onBack}/>
      <div style={{ flex: 1, overflowY: 'auto', padding: '15px 15px 44px', position: 'relative' }}>
        <Blobs/>
        <div style={{ position: 'relative', zIndex: 1 }}>

          {/* Status card */}
          <div style={{ ...glass(), padding: '17px 17px', marginBottom: 16 }}>
            <div style={{ ...sg(10, 700, WC.text3), letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>Current Status</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{ position: 'relative', width: 14, height: 14, flexShrink: 0 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: si.dot, position: 'absolute', top: 1, left: 1 }}/>
                {state !== 'no_record' && state !== 'day_complete' && (
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: si.dot, opacity: 0.35, animation: 'wcPulse 2s ease-in-out infinite' }}/>
                )}
              </div>
              <div>
                <div style={{ ...sg(14, 600, si.color), letterSpacing: '-0.01em' }}>{si.label}</div>
                <div style={{ ...dm(11, 400, WC.text3), marginTop: 1 }}>{si.sub}</div>
              </div>
            </div>
          </div>

          {/* Actions */}
          {state !== 'day_complete' && (
            <div style={{ marginBottom: 20 }}>
              <SectionLabel>Actions</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {state === 'no_record' && <PrimaryBtn loading={loading} onClick={() => doAction('home_in')}>Check In from Home</PrimaryBtn>}
                {state === 'home_in' && <>
                  <PrimaryBtn loading={loading} onClick={() => setDialog('site')}>Check In at Site</PrimaryBtn>
                  <OutlineBtn onClick={() => setDialog('market')}>Go to Market</OutlineBtn>
                  <OutlineBtn color="#E11D48" onClick={() => doAction('home_out')}>Check Out from Home</OutlineBtn>
                </>}
                {state === 'site_in' && <>
                  <PrimaryBtn loading={loading} onClick={() => setDialog('market')}>Go to Market</PrimaryBtn>
                  <OutlineBtn color="#E11D48" onClick={() => doAction('site_out')}>Leave Site</OutlineBtn>
                </>}
                {state === 'market_in' && <OutlineBtn color="#E11D48" onClick={() => doAction('market_out')}>Leave Market</OutlineBtn>}
              </div>

              {/* Inline dialog */}
              {dialog && (
                <div style={{ ...glass({ border: `1.5px solid ${WC.accent}44` }), padding: '15px 15px', marginTop: 12, animation: 'wcSlideDown 0.22s ease both' }}>
                  <div style={{ ...sg(12, 600, WC.accent), marginBottom: 12 }}>
                    {dialog === 'site' ? '📍 Site Details' : '📍 Market Details'}
                  </div>
                  {dialog === 'site' ? (
                    <>
                      <InputField label="Site Name" value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="e.g. Senken Gurugaon Site"/>
                      <InputField label="Site ID (optional)" value={siteId} onChange={e => setSiteId(e.target.value)} placeholder="e.g. Site-001"/>
                    </>
                  ) : (
                    <InputField label="Market Name" value={mktName} onChange={e => setMktName(e.target.value)} placeholder="e.g. INA Market"/>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <PrimaryBtn loading={loading} onClick={() => doAction(dialog === 'site' ? 'site_in' : 'market_in')} style={{ flex: 1 }}>Confirm</PrimaryBtn>
                    <OutlineBtn onClick={() => setDialog(null)} style={{ flex: 1, padding: '13px 10px' }}>Cancel</OutlineBtn>
                  </div>
                </div>
              )}
            </div>
          )}

          {state === 'day_complete' && (
            <div style={{ ...glass({ borderRadius: 14, border: '1.5px solid #16A34A22' }), padding: '22px', marginBottom: 20, textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#D1FAE5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div style={{ ...sg(15, 700, '#047857') }}>Day Complete!</div>
              <div style={{ ...dm(11, 400, WC.text3), marginTop: 4 }}>Great work today, Arjun.</div>
            </div>
          )}

          {/* Timeline */}
          {events.length > 0 && (
            <>
              <SectionLabel>Today's Log</SectionLabel>
              <div style={{ ...glass({ borderRadius: 14 }), padding: '15px 14px' }}>
                {events.map((e, i) => <TimelineItem key={i} type={e.type} time={e.time} place={e.place} last={i === events.length - 1}/>)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Office Attendance screen ───────────────────────────────────
function OfficeAttScreen({ onBack }) {
  const [checkedIn, setCheckedIn] = React.useState(false);
  const [location, setLocation]   = React.useState('');
  const [events, setEvents]       = React.useState([]);
  const [loading, setLoading]     = React.useState(false);
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const now = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  const toggle = () => {
    setLoading(true);
    setTimeout(() => {
      if (!checkedIn) {
        setEvents(prev => [...prev, { type: 'office_in', time: now(), place: location || 'Office' }]);
        setCheckedIn(true);
      } else {
        setEvents(prev => [...prev, { type: 'office_out', time: now(), place: '' }]);
        setCheckedIn(false); setLocation('');
      }
      setLoading(false);
    }, 900);
  };

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: WC.bg }}>
      <NavHeader title="Attendance" sub={today} onBack={onBack}/>
      <div style={{ flex: 1, overflowY: 'auto', padding: '15px 15px 44px', position: 'relative' }}>
        <Blobs/>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ ...glass(), padding: '22px 18px', marginBottom: 16, textAlign: 'center' }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: checkedIn ? '#D1FAE5' : WC.accLight, margin: '0 auto 14px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.3s' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={checkedIn ? '#059669' : WC.accent} strokeWidth="2" style={{ transition: 'stroke 0.3s' }}>
                <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>
              </svg>
            </div>
            <div style={{ ...sg(14, 600, checkedIn ? '#059669' : WC.text1), marginBottom: 3 }}>
              {checkedIn ? 'Currently Checked In' : 'Not Checked In'}
            </div>
            <div style={{ ...dm(11, 400, WC.text3) }}>
              {checkedIn ? 'Multi-cycle supported · Tap to check out' : 'Tap below to start your attendance'}
            </div>
            {!checkedIn && (
              <div style={{ marginTop: 16, textAlign: 'left' }}>
                <InputField label="Where are you?" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Head Office, Vasant Kunj"/>
              </div>
            )}
            <div style={{ marginTop: checkedIn ? 18 : 4 }}>
              {checkedIn
                ? <OutlineBtn color="#E11D48" onClick={toggle}>Check Out</OutlineBtn>
                : <PrimaryBtn loading={loading} onClick={toggle}>Check In →</PrimaryBtn>
              }
            </div>
          </div>

          {events.length > 0 && (
            <>
              <SectionLabel>Today's Log</SectionLabel>
              <div style={{ ...glass({ borderRadius: 14 }), padding: '15px 14px' }}>
                {events.map((e, i) => <TimelineItem key={i} type={e.type} time={e.time} place={e.place} last={i === events.length - 1}/>)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Notifications screen ──────────────────────────────────────
function NotificationsScreen({ onBack }) {
  const [notifs, setNotifs] = React.useState(DEMO_NOTIFS);
  const unread = notifs.filter(n => !n.read).length;

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: WC.bg }}>
      <NavHeader title="Notifications" sub={unread > 0 ? `${unread} unread` : 'All caught up'} onBack={onBack}/>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 15px 44px', position: 'relative' }}>
        <Blobs/>
        <div style={{ position: 'relative', zIndex: 1 }}>
          {unread > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={() => setNotifs(notifs.map(n => ({...n, read: true})))}
                style={{ ...dm(11, 500, WC.accent), background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
                Mark all as read
              </button>
            </div>
          )}
          {notifs.map(n => <NotifItem key={n.id} {...n}/>)}
        </div>
      </div>
    </div>
  );
}

// ── Leave screen ──────────────────────────────────────────────
function LeaveScreen({ onBack }) {
  const [leaves, setLeaves]   = React.useState(DEMO_LEAVES);
  const [showForm, setShowForm] = React.useState(false);
  const pending = leaves.filter(l => l.status === 'pending').length;

  const handleNewLeave = (entry) => {
    setLeaves(prev => [{ id: Date.now(), ...entry, status: 'pending' }, ...prev]);
    setShowForm(false);
  };

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: WC.bg, position: 'relative' }}>
      <NavHeader title="My Leaves" sub={pending > 0 ? `${pending} pending` : 'All resolved'} onBack={onBack}/>
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 15px 80px', position: 'relative' }}>
        <Blobs/>
        <div style={{ position: 'relative', zIndex: 1 }}>
          {leaves.map(l => <LeaveCard key={l.id} {...l}/>)}
        </div>
      </div>

      {/* FAB */}
      <div style={{ position: 'absolute', bottom: 22, right: 18, zIndex: 10 }}>
        <button onClick={() => setShowForm(true)} style={{ background: 'linear-gradient(130deg, #1A3B6E, #2563EB)', color: 'white', border: 'none', borderRadius: 16, padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', boxShadow: '0 6px 24px rgba(37,99,235,0.42)', ...sg(13, 600, 'white') }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Apply Leave
        </button>
      </div>

      {/* Slide-up form sheet */}
      {showForm && <LeaveFormSheet onClose={() => setShowForm(false)} onSubmit={handleNewLeave}/>}
    </div>
  );
}

function LeaveFormSheet({ onClose, onSubmit }) {
  const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Annual Leave', 'Emergency Leave', 'Unpaid Leave'];
  const [type, setType]       = React.useState(LEAVE_TYPES[0]);
  const [from, setFrom]       = React.useState('');
  const [to, setTo]           = React.useState('');
  const [reason, setReason]   = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const calcDays = () => {
    if (!from || !to) return 0;
    const diff = (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24);
    return diff >= 0 ? diff + 1 : 0;
  };
  const days = calcDays();

  const handleSubmit = () => {
    if (!from || !to || !reason.trim()) return;
    setLoading(true);
    setTimeout(() => {
      const fmt = d => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      onSubmit({ type, from: fmt(from), to: fmt(to), days, reason: reason.trim() });
    }, 1100);
  };

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(10,22,40,0.45)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)', zIndex: 20 }}/>
      {/* Sheet */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 30, background: 'white', borderRadius: '22px 22px 0 0', padding: '0 18px 36px', boxShadow: '0 -8px 40px rgba(10,22,40,0.18)', animation: 'wcSheetUp 0.28s cubic-bezier(0.4,0,0.2,1) both' }}>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 99, background: '#E2E8F0' }}/>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, marginTop: 6 }}>
          <div style={{ ...sg(16, 700) }}>Apply Leave</div>
          <button onClick={onClose} style={{ background: '#F1F5F9', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: WC.text2 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Leave type selector */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ ...sg(11, 600, WC.text3), letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Leave Type</label>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {LEAVE_TYPES.map(t => (
              <button key={t} onClick={() => setType(t)} style={{ padding: '7px 12px', borderRadius: 20, border: `1.5px solid ${type === t ? WC.accent : WC.border}`, background: type === t ? WC.accLight : 'white', cursor: 'pointer', ...dm(11, type === t ? 600 : 400, type === t ? WC.accent : WC.text2), transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Date range */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div>
            <label style={{ ...sg(11, 600, WC.text3), letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              style={{ width: '100%', padding: '11px 12px', border: `1.5px solid ${WC.border}`, borderRadius: 12, background: 'white', outline: 'none', ...dm(13, 400, WC.text1), boxSizing: 'border-box' }}/>
          </div>
          <div>
            <label style={{ ...sg(11, 600, WC.text3), letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              style={{ width: '100%', padding: '11px 12px', border: `1.5px solid ${WC.border}`, borderRadius: 12, background: 'white', outline: 'none', ...dm(13, 400, WC.text1), boxSizing: 'border-box' }}/>
          </div>
        </div>

        {/* Duration badge */}
        {days > 0 && (
          <div style={{ ...glass({ borderRadius: 10, boxShadow: 'none' }), padding: '8px 13px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={WC.accent} strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span style={{ ...dm(12, 500, WC.text2) }}>{days} day{days > 1 ? 's' : ''} of leave</span>
          </div>
        )}

        {/* Reason */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ ...sg(11, 600, WC.text3), letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Reason</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Brief reason for leave…" rows={3}
            style={{ width: '100%', padding: '11px 13px', border: `1.5px solid ${WC.border}`, borderRadius: 12, background: 'white', outline: 'none', resize: 'none', ...dm(13, 400, WC.text1), boxSizing: 'border-box', lineHeight: 1.5 }}/>
        </div>

        <PrimaryBtn loading={loading} disabled={!from || !to || !reason.trim() || days <= 0} onClick={handleSubmit}>
          Submit Application →
        </PrimaryBtn>
      </div>
    </>
  );
}

// ── M&T Buy screen ────────────────────────────────────────────
function MtBuyScreen({ onBack }) {
  const [siteName, setSiteName] = React.useState('');
  const [siteId, setSiteId]     = React.useState('');
  const [items, setItems]       = React.useState([{ id: 1, name: '', qty: '', unit: '', price: '' }]);
  const [photos, setPhotos]     = React.useState(0);
  const [loading, setLoading]   = React.useState(false);
  const [done, setDone]         = React.useState(false);

  const addItem = () => setItems(prev => [...prev, { id: Date.now(), name: '', qty: '', unit: '', price: '' }]);
  const upd = (i, k, v) => setItems(items.map((it, idx) => idx === i ? {...it, [k]: v} : it));
  const total = items.reduce((s, it) => s + (parseFloat(it.qty || 0) * parseFloat(it.price || 0)), 0);

  if (done) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: WC.bg }}>
        <NavHeader title="M&T Buy" onBack={onBack}/>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ width: 68, height: 68, borderRadius: '50%', background: '#D1FAE5', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, animation: 'wcFadeUp 0.4s ease both' }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div style={{ ...sg(17, 700, '#047857'), marginBottom: 6 }}>Submitted!</div>
          <div style={{ ...dm(12, 400, WC.text3), textAlign: 'center', marginBottom: 24 }}>Your purchase is pending approval.</div>
          <PrimaryBtn onClick={onBack} style={{ maxWidth: 200 }}>← Back to Home</PrimaryBtn>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: WC.bg }}>
      <NavHeader title="M&T Buy" sub="Log site purchase" onBack={onBack}/>
      <div style={{ flex: 1, overflowY: 'auto', padding: '15px 15px 36px', position: 'relative' }}>
        <Blobs/>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ ...glass({ borderRadius: 14 }), padding: '15px', marginBottom: 12 }}>
            <SectionLabel>Site Details</SectionLabel>
            <InputField label="Site Name" value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="e.g. Senken Gurugaon Site"/>
            <InputField label="Site ID (optional)" value={siteId} onChange={e => setSiteId(e.target.value)} placeholder="e.g. Site-001"/>
          </div>

          <div style={{ ...glass({ borderRadius: 14 }), padding: '15px', marginBottom: 12 }}>
            <SectionLabel>Items</SectionLabel>
            {items.map((item, idx) => (
              <div key={item.id} style={{ borderBottom: idx < items.length - 1 ? `1px solid ${WC.border}` : 'none', paddingBottom: idx < items.length - 1 ? 14 : 0, marginBottom: idx < items.length - 1 ? 14 : 0 }}>
                <div style={{ ...sg(10, 700, WC.text3), marginBottom: 8, letterSpacing: '0.06em' }}>ITEM {idx + 1}</div>
                <InputField label="Item Name" value={item.name} onChange={e => upd(idx, 'name', e.target.value)} placeholder="e.g. Cement bags"/>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <InputField label="Qty"   value={item.qty}   onChange={e => upd(idx, 'qty',   e.target.value)} placeholder="0"/>
                  <InputField label="Unit"  value={item.unit}  onChange={e => upd(idx, 'unit',  e.target.value)} placeholder="kg"/>
                  <InputField label="₹/Unit" value={item.price} onChange={e => upd(idx, 'price', e.target.value)} placeholder="0"/>
                </div>
              </div>
            ))}
            <button onClick={addItem} style={{ width: '100%', border: `1.5px dashed ${WC.border}`, borderRadius: 12, padding: '10px', background: 'transparent', cursor: 'pointer', ...dm(12, 500, WC.accent), marginTop: 10 }}>
              + Add Item
            </button>
          </div>

          {total > 0 && (
            <div style={{ ...glass({ borderRadius: 12 }), padding: '11px 15px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ ...sg(12, 600) }}>Grand Total</span>
              <span style={{ ...sg(15, 700, WC.accent) }}>₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
            </div>
          )}

          <PhotoSection count={photos} onAdd={() => setPhotos(p => p + 1)}/>

          <PrimaryBtn loading={loading} onClick={() => { setLoading(true); setTimeout(() => { setLoading(false); setDone(true); }, 1400); }}>
            Submit for Approval →
          </PrimaryBtn>
        </div>
      </div>
    </div>
  );
}

// ── Photo section helper ──────────────────────────────────────
function PhotoSection({ count, onAdd }) {
  return (
    <div style={{ ...glass({ borderRadius: 14 }), padding: '14px 15px', marginBottom: 12 }}>
      <SectionLabel>Photos</SectionLabel>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={{ width: 60, height: 60, borderRadius: 10, background: WC.accLight, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={WC.accent} strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          </div>
        ))}
        <button onClick={onAdd} style={{ width: 60, height: 60, borderRadius: 10, border: `1.5px dashed ${WC.border}`, background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, cursor: 'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={WC.accent} strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
          <span style={{ ...dm(9, 500, WC.accent) }}>Add</span>
        </button>
      </div>
    </div>
  );
}

// ── Shared done state ─────────────────────────────────────────
function DoneView({ title, msg, onBack }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <div style={{ width: 68, height: 68, borderRadius: '50%', background: '#D1FAE5', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, animation: 'wcFadeUp 0.4s ease both' }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div style={{ ...sg(17, 700, '#047857'), marginBottom: 6 }}>{title}</div>
      <div style={{ ...dm(12, 400, WC.text3), textAlign: 'center', marginBottom: 26 }}>{msg}</div>
      <PrimaryBtn onClick={onBack} style={{ maxWidth: 220 }}>← Back to Home</PrimaryBtn>
    </div>
  );
}

// ── Shared add-item list ──────────────────────────────────────
function AddItemList({ items, onUpdate, onAdd, columns }) {
  const upd = (i, k, v) => onUpdate(items.map((it, idx) => idx === i ? {...it, [k]: v} : it));
  return (
    <>
      {items.map((item, idx) => (
        <div key={item.id} style={{ borderBottom: idx < items.length - 1 ? `1px solid ${WC.border}` : 'none', paddingBottom: idx < items.length - 1 ? 14 : 0, marginBottom: idx < items.length - 1 ? 14 : 0 }}>
          <div style={{ ...sg(10, 700, WC.text3), marginBottom: 8, letterSpacing: '0.06em' }}>ITEM {idx + 1}</div>
          <InputField label="Item Name" value={item.name} onChange={e => upd(idx, 'name', e.target.value)} placeholder="e.g. Steel rods"/>
          <div style={{ display: 'grid', gridTemplateColumns: columns.map(() => '1fr').join(' '), gap: 8 }}>
            {columns.map(col => (
              <InputField key={col.key} label={col.label} value={item[col.key] || ''} onChange={e => upd(idx, col.key, e.target.value)} placeholder={col.ph || ''}/>
            ))}
          </div>
        </div>
      ))}
      <button onClick={onAdd} style={{ width: '100%', border: `1.5px dashed ${WC.border}`, borderRadius: 12, padding: '10px', background: 'transparent', cursor: 'pointer', ...dm(12, 500, WC.accent), marginTop: 10 }}>
        + Add Item
      </button>
    </>
  );
}

// ── M&T Request screen ────────────────────────────────────────
function MtRequestScreen({ onBack }) {
  const [siteName, setSiteName] = React.useState('');
  const [siteId, setSiteId]     = React.useState('');
  const [items, setItems]       = React.useState([{ id: 1, name: '', qty: '', unit: '', notes: '' }]);
  const [photos, setPhotos]     = React.useState(0);
  const [urgency, setUrgency]   = React.useState('normal');
  const [loading, setLoading]   = React.useState(false);
  const [done, setDone]         = React.useState(false);

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: WC.bg }}>
      <NavHeader title="M&T Request" sub="Request materials & tools" onBack={onBack}/>
      <div style={{ flex: 1, overflowY: 'auto', padding: '15px 15px 36px', position: 'relative' }}>
        <Blobs/>
        {done
          ? <DoneView title="Request Sent!" msg="Your M&T request is pending admin approval." onBack={onBack}/>
          : (
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ ...glass({ borderRadius: 14 }), padding: '15px', marginBottom: 12 }}>
                <SectionLabel>Site Details</SectionLabel>
                <InputField label="Site Name" value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="e.g. Senken Gurugaon"/>
                <InputField label="Site ID (optional)" value={siteId} onChange={e => setSiteId(e.target.value)} placeholder="e.g. Site-001"/>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ ...sg(11, 600, WC.text3), letterSpacing: '0.04em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Urgency</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['normal', 'urgent', 'critical'].map(u => (
                      <button key={u} onClick={() => setUrgency(u)} style={{ flex: 1, padding: '9px 4px', borderRadius: 10, border: `1.5px solid ${urgency === u ? WC.accent : WC.border}`, background: urgency === u ? WC.accLight : 'rgba(255,255,255,0.6)', cursor: 'pointer', ...dm(11, urgency === u ? 600 : 400, urgency === u ? WC.accent : WC.text2), textTransform: 'capitalize', transition: 'all 0.15s' }}>
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ ...glass({ borderRadius: 14 }), padding: '15px', marginBottom: 12 }}>
                <SectionLabel>Requested Items</SectionLabel>
                <AddItemList items={items} onUpdate={setItems}
                  onAdd={() => setItems(p => [...p, { id: Date.now(), name: '', qty: '', unit: '', notes: '' }])}
                  columns={[{ key: 'qty', label: 'Qty', ph: '0' }, { key: 'unit', label: 'Unit', ph: 'pcs' }, { key: 'notes', label: 'Notes', ph: 'Optional' }]}/>
              </div>
              <PhotoSection count={photos} onAdd={() => setPhotos(p => p + 1)}/>
              <PrimaryBtn loading={loading} onClick={() => { setLoading(true); setTimeout(() => { setLoading(false); setDone(true); }, 1400); }}>
                Submit Request →
              </PrimaryBtn>
            </div>
          )
        }
      </div>
    </div>
  );
}

// ── Transfer screen (Material + Tool) ─────────────────────────
function TransferScreen({ onBack, type }) {
  const isMatl = type === 'material';
  const [from, setFrom]       = React.useState('');
  const [to, setTo]           = React.useState('');
  const [byWho, setByWho]     = React.useState('');
  const [recvBy, setRecvBy]   = React.useState('');
  const [items, setItems]     = React.useState([{ id: 1, name: '', qty: '', unit: '', condition: '' }]);
  const [photos, setPhotos]   = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone]       = React.useState(false);

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: WC.bg }}>
      <NavHeader title={isMatl ? 'Material Transfer' : 'Tool Transfer'} sub="Log transfer details" onBack={onBack}/>
      <div style={{ flex: 1, overflowY: 'auto', padding: '15px 15px 36px', position: 'relative' }}>
        <Blobs/>
        {done
          ? <DoneView title="Transfer Logged!" msg="Your transfer record has been submitted." onBack={onBack}/>
          : (
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ ...glass({ borderRadius: 14 }), padding: '15px', marginBottom: 12 }}>
                <SectionLabel>Transfer Details</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <InputField label="From" value={from} onChange={e => setFrom(e.target.value)} placeholder="Origin site"/>
                  <InputField label="To"   value={to}   onChange={e => setTo(e.target.value)}   placeholder="Destination"/>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <InputField label="Transferred By" value={byWho}  onChange={e => setByWho(e.target.value)}  placeholder="Name"/>
                  <InputField label="Received By"    value={recvBy} onChange={e => setRecvBy(e.target.value)} placeholder="Name"/>
                </div>
              </div>
              <div style={{ ...glass({ borderRadius: 14 }), padding: '15px', marginBottom: 12 }}>
                <SectionLabel>Items</SectionLabel>
                <AddItemList items={items} onUpdate={setItems}
                  onAdd={() => setItems(p => [...p, { id: Date.now(), name: '', qty: '', unit: '', condition: '' }])}
                  columns={[{ key: 'qty', label: 'Qty', ph: '0' }, { key: 'unit', label: 'Unit', ph: 'pcs' }, { key: 'condition', label: 'Condition', ph: 'Good' }]}/>
              </div>
              <PhotoSection count={photos} onAdd={() => setPhotos(p => p + 1)}/>
              <PrimaryBtn loading={loading} onClick={() => { setLoading(true); setTimeout(() => { setLoading(false); setDone(true); }, 1400); }}>
                Submit Transfer →
              </PrimaryBtn>
            </div>
          )
        }
      </div>
    </div>
  );
}

// ── Work Progress screen ──────────────────────────────────────
function WorkProgressScreen({ onBack }) {
  const [siteName, setSiteName]   = React.useState('');
  const [siteId, setSiteId]       = React.useState('');
  const [hours, setHours]         = React.useState('');
  const [workers, setWorkers]     = React.useState('');
  const [description, setDesc]    = React.useState('');
  const [progress, setProgress]   = React.useState(50);
  const [photos, setPhotos]       = React.useState(0);
  const [loading, setLoading]     = React.useState(false);
  const [done, setDone]           = React.useState(false);
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  const progColor = progress < 30 ? '#E11D48' : progress < 70 ? '#D97706' : '#16A34A';

  return (
    <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', background: WC.bg }}>
      <NavHeader title="Work Progress" sub={today} onBack={onBack}/>
      <div style={{ flex: 1, overflowY: 'auto', padding: '15px 15px 36px', position: 'relative' }}>
        <Blobs/>
        {done
          ? <DoneView title="Report Submitted!" msg="Your progress report has been saved." onBack={onBack}/>
          : (
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ ...glass({ borderRadius: 14 }), padding: '15px', marginBottom: 12 }}>
                <SectionLabel>Site Details</SectionLabel>
                <InputField label="Site Name" value={siteName} onChange={e => setSiteName(e.target.value)} placeholder="e.g. Senken Gurugaon"/>
                <InputField label="Site ID (optional)" value={siteId} onChange={e => setSiteId(e.target.value)} placeholder="e.g. Site-001"/>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <InputField label="Hours Worked" value={hours} onChange={e => setHours(e.target.value)} placeholder="e.g. 8"/>
                  <InputField label="Workers On Site" value={workers} onChange={e => setWorkers(e.target.value)} placeholder="e.g. 12"/>
                </div>
              </div>

              <div style={{ ...glass({ borderRadius: 14 }), padding: '15px', marginBottom: 12 }}>
                <SectionLabel>Overall Completion</SectionLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{ flex: 1, height: 8, borderRadius: 99, background: '#E2E8F0', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${progress}%`, borderRadius: 99, background: progColor, transition: 'width 0.3s ease, background 0.3s ease' }}/>
                  </div>
                  <span style={{ ...sg(14, 700, progColor), minWidth: 38, textAlign: 'right' }}>{progress}%</span>
                </div>
                <input type="range" min="0" max="100" value={progress} onChange={e => setProgress(+e.target.value)}
                  style={{ width: '100%', accentColor: progColor, cursor: 'pointer' }}/>
              </div>

              <div style={{ ...glass({ borderRadius: 14 }), padding: '15px', marginBottom: 12 }}>
                <SectionLabel>Work Description</SectionLabel>
                <div style={{ border: `1.5px solid ${WC.border}`, borderRadius: 12, background: 'rgba(255,255,255,0.95)', overflow: 'hidden' }}>
                  <textarea value={description} onChange={e => setDesc(e.target.value)}
                    placeholder="Describe today's progress — tasks completed, issues encountered, material used…"
                    rows={4}
                    style={{ width: '100%', padding: '12px 13px', border: 'none', background: 'transparent', outline: 'none', resize: 'none', ...dm(13, 400, WC.text1), boxSizing: 'border-box', lineHeight: 1.55 }}/>
                </div>
              </div>

              <PhotoSection count={photos} onAdd={() => setPhotos(p => p + 1)}/>
              <PrimaryBtn loading={loading} onClick={() => { setLoading(true); setTimeout(() => { setLoading(false); setDone(true); }, 1400); }}>
                Submit Report →
              </PrimaryBtn>
            </div>
          )
        }
      </div>
    </div>
  );
}

Object.assign(window, {
  MODULES, DEMO_NOTIFS, DEMO_LEAVES,
  PhotoSection, DoneView,
  LoginScreen, HomeScreen,
  AttendanceScreen, OfficeAttScreen,
  NotificationsScreen, LeaveScreen,
  MtBuyScreen, MtRequestScreen,
  TransferScreen, WorkProgressScreen,
});
