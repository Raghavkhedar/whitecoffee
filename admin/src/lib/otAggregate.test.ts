// Tests for the range/month aggregation. Run: npx tsx src/lib/otAggregate.test.ts
import { computeRangeLedger, settlementCash } from './otAggregate';

let passed = 0, failed = 0;
function eq(name: string, got: number | string, want: number | string) {
  if (got === want) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got ${got}, want ${want}`); }
}

// Build an attendance event at a real IST wall-clock time (the ledger reads timestamps as IST).
const ev = (userId: string, date: string, type: string, hhmm: string) =>
  ({ id: `${date}-${type}-${hhmm}`, userId, date, type,
     timestamp: { seconds: Math.floor(new Date(`${date}T${hhmm}:00+05:30`).getTime() / 1000) } } as never);

const U = 'u1';
const noHol = new Set<string>();

// 2026-06-01 is a Monday (normal day). Shift 10:00–18:00 (480) + declared 30.
// In 10:00, out 19:00 → 60 min late-out OT (auto 30 up to declared, 30 pending), no shortage.
const planNormal = [{ id: '2026-06-01', userId: U, date: '2026-06-01', startTime: '10:00', endTime: '18:00', declaredOtMins: 30 } as never];
const evNormal = [ev(U, '2026-06-01', 'site_in', '10:00'), ev(U, '2026-06-01', 'site_out', '19:00')];

console.log('Normal day (10:00–18:00 shift, declared 30, worked 10:00–19:00):');
let r = computeRangeLedger(U, evNormal, planNormal, [], [], noHol);
eq('autoOt = 30', r.autoOtMins, 30);
eq('pending = 30', r.pendingOtMins, 30);
eq('pending dates = 1', r.pendingDates.length, 1);
eq('shortage = 0', r.shortageMins, 0);
eq('net = 30 (auto only; pending not credited)', r.netMins, 30);

console.log('\nSame day, the +30 beyond-declared approved via ot_approvals (ordinary flow: requestedMins = pendingExtraMins = 30):');
const appr = [{ id: '2026-06-01', userId: U, date: '2026-06-01', requestedMins: 30, approvedMins: 30, status: 'approved' } as never];
r = computeRangeLedger(U, evNormal, planNormal, appr, [], noHol);
eq('granted = 30', r.grantedOtMins, 30);
eq('pending now 0 (remaining = 30 - 30 = 0)', r.pendingDates.length, 0);
eq('net = 60 (auto 30 + granted 30)', r.netMins, 60);

console.log('\nSunday rest-day work (2026-06-07 is a Sunday), no approval, worked 300:');
// Protocol 1: rest-day work is never auto-credited. The whole worked window becomes a
// pending OT request; net stays 0 and the date shows up in pendingDates until an admin acts.
const evSun = [ev(U, '2026-06-07', 'site_in', '10:00'), ev(U, '2026-06-07', 'site_out', '15:00')];
r = computeRangeLedger(U, evSun, [], [], [], noHol);
eq('net = 0 (nothing auto-credited)', r.netMins, 0);
eq('pending = 300 (whole worked window)', r.pendingOtMins, 300);
eq('pending dates = 1', r.pendingDates.length, 1);
eq('pending dates includes the Sunday', r.pendingDates[0], '2026-06-07');

console.log('\nSame Sunday, admin partially approves 120 of the 300 pending minutes (ordinary flow: requestedMins = the full 300 asked, per ot-shortage/page.tsx\'s approveOt call — the admin decided on the whole amount, granting only part of it):');
const apprSun = [{ id: '2026-06-07', userId: U, date: '2026-06-07', requestedMins: 300, approvedMins: 120, status: 'approved' } as never];
r = computeRangeLedger(U, evSun, [], apprSun, [], noHol);
eq('granted = 120 (exactly the approved minutes)', r.grantedOtMins, 120);
eq('net = 120 (exactly the approved minutes)', r.netMins, 120);
eq('no longer pending (remaining = 300 - 300 = 0; the full ask was decided)', r.pendingDates.length, 0);

console.log('\n[BUG FIX] Same Sunday, an UNRELATED manual grant only requests 60 of the 300 pending minutes (setManualOt-style: requestedMins = approvedMins = 60) — the other 240 must remain pending, not vanish:');
const manualUnrelated = [{ id: '2026-06-07', userId: U, date: '2026-06-07', requestedMins: 60, approvedMins: 60, status: 'approved', manual: true } as never];
r = computeRangeLedger(U, evSun, [], manualUnrelated, [], noHol);
eq('granted = 60 (just the manual grant)', r.grantedOtMins, 60);
eq('STILL pending: remaining = 300 - 60 = 240', r.pendingOtMins, 240);
eq('pending dates = 1 (the doc did not fully decide the date)', r.pendingDates.length, 1);
eq('pending dates includes the Sunday', r.pendingDates[0], '2026-06-07');
eq('net = 60 (auto 0 + granted 60; the pending 240 is not credited)', r.netMins, 60);

console.log('\n[BUG FIX — exact brief scenario] Sunday (2026-06-28) worked 09:00–19:00 (600 min pending); an unrelated 60-min manual grant must leave 540 pending:');
const evSun2 = [ev(U, '2026-06-28', 'site_in', '09:00'), ev(U, '2026-06-28', 'site_out', '19:00')];
const manualGrant60 = [{ id: '2026-06-28', userId: U, date: '2026-06-28', requestedMins: 60, approvedMins: 60, status: 'approved', manual: true } as never];
r = computeRangeLedger(U, evSun2, [], manualGrant60, [], noHol);
eq('pending remaining = 600 - 60 = 540', r.pendingOtMins, 540);
eq('pending dates = 1', r.pendingDates.length, 1);
eq('granted = 60', r.grantedOtMins, 60);

console.log('\nDecision requestedMins EXCEEDS pendingExtraMins (over-covering) still reports 0 remaining, not negative:');
const evSun3 = [ev(U, '2026-06-14', 'site_in', '10:00'), ev(U, '2026-06-14', 'site_out', '12:00')]; // 120 min pending
const overCover = [{ id: '2026-06-14', userId: U, date: '2026-06-14', requestedMins: 500, approvedMins: 120, status: 'approved' } as never];
r = computeRangeLedger(U, evSun3, [], overCover, [], noHol);
eq('pending dates = 0 (over-covered, remaining clamped to 0)', r.pendingDates.length, 0);
eq('pending mins = 0', r.pendingOtMins, 0);
eq('granted = 120', r.grantedOtMins, 120);

console.log('\nRejected day: requestedMins covers the full original ask, approvedMins = 0 → nets 0 granted OT and is correctly NOT pending:');
const evSun4 = [ev(U, '2026-06-21', 'site_in', '10:00'), ev(U, '2026-06-21', 'site_out', '13:00')]; // 180 min pending
const rejected = [{ id: '2026-06-21', userId: U, date: '2026-06-21', requestedMins: 180, approvedMins: 0, status: 'rejected' } as never];
r = computeRangeLedger(U, evSun4, [], rejected, [], noHol);
eq('granted = 0 (rejected)', r.grantedOtMins, 0);
eq('net = 0', r.netMins, 0);
eq('pending dates = 0 (remaining = 180 - 180 = 0; fully decided as rejected)', r.pendingDates.length, 0);

console.log('\nWO day status counted:');
const woStatus = [{ id: '2026-06-02', userId: U, date: '2026-06-02', status: 'WO' } as never];
r = computeRangeLedger(U, [], [], [], woStatus, noHol);
eq('woDates = 1', r.woDates.length, 1);
eq('woDebit = 480', r.woDebitMins, 480);
eq('net = -480', r.netMins, -480);

console.log('\nRegularized-to-Present day with effective in/out (missed punch, no events):');
// 2026-06-03 Wednesday, shift 10:00–18:00 (480). Admin regularized with worked 09:00–17:00 (480
// window but inTime 10:00 outTime 16:30 → 390 worked → 90 shortage). Use 10:00→16:30.
const planReg = [{ id: '2026-06-03', userId: U, date: '2026-06-03', startTime: '10:00', endTime: '18:00' } as never];
const statusReg = [{ id: '2026-06-03', userId: U, date: '2026-06-03', status: 'Present', inTime: '10:00', outTime: '16:30' } as never];
r = computeRangeLedger(U, [], planReg, [], statusReg, noHol);
eq('reg shortage = 90 (480 − 390)', r.shortageMins, 90);
eq('reg net = -90', r.netMins, -90);

console.log('\nRegularized in/out OVERRIDES raw events for the same date:');
// Events say worked 540 (would be 60 surplus), but admin regularized to 10:00–18:30 (510 → +30 OT).
const statusReg2 = [{ id: '2026-06-01', userId: U, date: '2026-06-01', status: 'Present', inTime: '10:00', outTime: '18:30' } as never];
r = computeRangeLedger(U, evNormal, planNormal, [], statusReg2, noHol);
eq('override autoOt = 30 (declared cap)', r.autoOtMins, 30);
eq('override pending = 0 (30 surplus all within declared)', r.pendingOtMins, 0);
eq('override shortage = 0', r.shortageMins, 0);

console.log('\nManual OT grant on a day with no events (counts as granted):');
const manualAppr = [{ id: '2026-06-04', userId: U, date: '2026-06-04', requestedMins: 120, approvedMins: 120, status: 'approved', manual: true } as never];
r = computeRangeLedger(U, [], [], manualAppr, [], noHol);
eq('granted = 120', r.grantedOtMins, 120);
eq('net = 120', r.netMins, 120);

console.log('\nEarly-in earns nothing (2026-06-08 Mon, shift 10:00–18:00, in 09:50 out 17:56):');
// Early-in 10m → ignored (no OT); early-out 4m → shortage.
const evDev = [ev(U, '2026-06-08', 'site_in', '09:50'), ev(U, '2026-06-08', 'site_out', '17:56')];
const planDev = [{ id: '2026-06-08', userId: U, date: '2026-06-08', startTime: '10:00', endTime: '18:00', declaredOtMins: 0 } as never];
r = computeRangeLedger(U, evDev, planDev, [], [], noHol);
eq('early-in OT = 0', r.pendingOtMins, 0);
eq('early-out shortage = 4', r.shortageMins, 4);
eq('net = -4 (shortage only)', r.netMins, -4);

console.log('\nOps with NO plan → falls back to default 10:00–18:00 (2026-06-09 Tue, worked 10:00–19:00):');
const evNoPlan = [ev(U, '2026-06-09', 'site_in', '10:00'), ev(U, '2026-06-09', 'site_out', '19:00')];
r = computeRangeLedger(U, evNoPlan, [], [], [], noHol);
eq('default shift → 60 pending OT', r.pendingOtMins, 60);
eq('default shift → 0 shortage', r.shortageMins, 0);

console.log('\nInverted window "06:00" end → treated as no plan → default 10:00–18:00 (devendra bug, 2026-06-10 Wed):');
const evInv = [ev(U, '2026-06-10', 'site_in', '09:50'), ev(U, '2026-06-10', 'site_out', '17:56')];
const planInv = [{ id: '2026-06-10', userId: U, date: '2026-06-10', startTime: '10:00', endTime: '06:00', declaredOtMins: 0 } as never];
r = computeRangeLedger(U, evInv, planInv, [], [], noHol);
eq('inverted → default → OT 0 (early-in ignored)', r.pendingOtMins, 0);
eq('inverted → default → shortage 4', r.shortageMins, 4);

console.log('\nsettlementCash (rate ₹800/day):');
eq('unworked WO → 0', settlementCash(800, 1, -480), 0);              // +800 − 800
eq('WO worked off (net 0) → +800', settlementCash(800, 1, 0), 800);  // kept the paid day
eq('WO + 300 rest-day (net -180) → 500', settlementCash(800, 1, -180), 500); // 800 − 300
eq('no WO, net +480 OT → +800', settlementCash(800, 0, 480), 800);
eq('no WO, net -240 shortage → -400', settlementCash(800, 0, -240), -400);

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
