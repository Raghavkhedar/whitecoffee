// Tests for the range/month aggregation. Run: npx tsx src/lib/otAggregate.test.ts
import { computeRangeLedger, settlementCash } from './otAggregate';

let passed = 0, failed = 0;
function eq(name: string, got: number | string, want: number | string) {
  if (got === want) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got ${got}, want ${want}`); }
}

// Build attendance in/out events. secs is minutes-from-an-epoch for simple deltas.
const ev = (userId: string, date: string, type: string, mins: number) =>
  ({ id: `${date}-${type}`, userId, date, type, timestamp: { seconds: mins * 60 } } as never);

const U = 'u1';
const noHol = new Set<string>();

// 2026-06-01 is a Monday (normal day). Shift 10:00–18:00 (480) + declared 30.
// Worked 09:?: use site_in at minute 0, site_out at minute 540 → 540 worked = 60 surplus.
const planNormal = [{ id: '2026-06-01', userId: U, date: '2026-06-01', startTime: '10:00', endTime: '18:00', declaredOtMins: 30 } as never];
const evNormal = [ev(U, '2026-06-01', 'site_in', 0), ev(U, '2026-06-01', 'site_out', 540)];

console.log('Normal day (480 shift, declared 30, worked 540):');
let r = computeRangeLedger(U, evNormal, planNormal, [], [], noHol);
eq('autoOt = 30', r.autoOtMins, 30);
eq('pending = 30', r.pendingOtMins, 30);
eq('pending dates = 1', r.pendingDates.length, 1);
eq('shortage = 0', r.shortageMins, 0);
eq('net = 30 (auto only; pending not credited)', r.netMins, 30);

console.log('\nSame day, the +30 beyond-declared approved via ot_approvals:');
const appr = [{ id: '2026-06-01', userId: U, date: '2026-06-01', approvedMins: 30, status: 'approved' } as never];
r = computeRangeLedger(U, evNormal, planNormal, appr, [], noHol);
eq('granted = 30', r.grantedOtMins, 30);
eq('pending now 0', r.pendingDates.length, 0);
eq('net = 60 (auto 30 + granted 30)', r.netMins, 60);

console.log('\nSunday rest-day work (2026-06-07 is a Sunday), authorized, worked 300:');
const planSun = [{ id: '2026-06-07', userId: U, date: '2026-06-07', startTime: '', endTime: '', otAuthorized: true } as never];
const evSun = [ev(U, '2026-06-07', 'site_in', 0), ev(U, '2026-06-07', 'site_out', 300)];
r = computeRangeLedger(U, evSun, planSun, [], [], noHol);
eq('restDayOt = 300', r.restDayOtMins, 300);
eq('net = 300', r.netMins, 300);
eq('unauthorized = 0', r.unauthorizedRestDates.length, 0);

console.log('\nSame Sunday but NOT authorized:');
r = computeRangeLedger(U, evSun, [], [], [], noHol);
eq('restDayOt = 0', r.restDayOtMins, 0);
eq('unauthorized = 1', r.unauthorizedRestDates.length, 1);
eq('net = 0', r.netMins, 0);

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
const manualAppr = [{ id: '2026-06-04', userId: U, date: '2026-06-04', approvedMins: 120, status: 'approved', manual: true } as never];
r = computeRangeLedger(U, [], [], manualAppr, [], noHol);
eq('granted = 120', r.grantedOtMins, 120);
eq('net = 120', r.netMins, 120);

console.log('\nsettlementCash (rate ₹800/day):');
eq('unworked WO → 0', settlementCash(800, 1, -480), 0);              // +800 − 800
eq('WO worked off (net 0) → +800', settlementCash(800, 1, 0), 800);  // kept the paid day
eq('WO + 300 rest-day (net -180) → 500', settlementCash(800, 1, -180), 500); // 800 − 300
eq('no WO, net +480 OT → +800', settlementCash(800, 0, 480), 800);
eq('no WO, net -240 shortage → -400', settlementCash(800, 0, -240), -400);

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
