// Standalone tests for partial leave approval date math.
// Run: npx tsx src/lib/leaveDates.test.ts
import {
  expandDateRange, grantedDates, ungrantedDates, grantedDayCount, requestedDayCount,
  isPartialApproval, isSunday, formatDayLabel, formatDatesShort, partialApprovalMessage,
  cancelledDates, effectiveGrantedDates, effectiveGrantedDayCount, isCancelled,
  isPartiallyCancelled, leaveCancelledMessage,
} from './leaveDates';

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}: got ${g}, want ${w}`); }
}

// 2026-07-21 is a Tuesday; 2026-07-26 is a Sunday.
const RANGE = { fromDate: '2026-07-21', toDate: '2026-07-25' };

console.log('Range expansion:');
eq('5-day range', expandDateRange('2026-07-21', '2026-07-25'),
  ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25']);
eq('single day (to === from)', expandDateRange('2026-07-21', '2026-07-21'), ['2026-07-21']);
eq('missing toDate → single day', expandDateRange('2026-07-21'), ['2026-07-21']);
eq('crosses a month boundary', expandDateRange('2026-07-30', '2026-08-02'),
  ['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']);
eq('crosses a leap-year February', expandDateRange('2028-02-27', '2028-03-01'),
  ['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
eq('inverted range → empty', expandDateRange('2026-07-25', '2026-07-21'), []);
eq('malformed input → empty', expandDateRange('nonsense', '2026-07-21'), []);

console.log('\nGranted dates (compatibility rule):');
eq('legacy approval, no approvedDates → whole range',
  grantedDates({ ...RANGE, status: 'approved' }),
  ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25']);
eq('empty approvedDates → whole range',
  grantedDates({ ...RANGE, status: 'approved', approvedDates: [] }),
  ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25']);
eq('subset is honoured',
  grantedDates({ ...RANGE, status: 'approved', approvedDates: ['2026-07-21', '2026-07-22', '2026-07-24'] }),
  ['2026-07-21', '2026-07-22', '2026-07-24']);
eq('unsorted approvedDates come back sorted',
  grantedDates({ ...RANGE, status: 'approved', approvedDates: ['2026-07-24', '2026-07-21'] }),
  ['2026-07-21', '2026-07-24']);
eq('date outside the requested range is dropped',
  grantedDates({ ...RANGE, status: 'approved', approvedDates: ['2026-07-22', '2026-08-09'] }),
  ['2026-07-22']);

console.log('\nUngranted dates (days the employee is expected at work):');
eq('complement of the grant',
  ungrantedDates({ ...RANGE, status: 'approved', approvedDates: ['2026-07-21', '2026-07-22', '2026-07-24'] }),
  ['2026-07-23', '2026-07-25']);
eq('full approval leaves nothing ungranted',
  ungrantedDates({ ...RANGE, status: 'approved' }), []);

console.log('\nDay counts:');
eq('requested count comes from the range, not totalDays', requestedDayCount(RANGE), 5);
eq('granted count on a partial grant',
  grantedDayCount({ ...RANGE, status: 'approved', approvedDates: ['2026-07-21', '2026-07-24'] }), 2);
eq('granted count on a legacy approval', grantedDayCount({ ...RANGE, status: 'approved' }), 5);
eq('single-day request counts 1', requestedDayCount({ fromDate: '2026-07-21', toDate: '2026-07-21' }), 1);

console.log('\nPartial vs full derivation:');
eq('approved subset → partial',
  isPartialApproval({ ...RANGE, status: 'approved', approvedDates: ['2026-07-21', '2026-07-22', '2026-07-24'] }), true);
eq('approved with every date listed → NOT partial',
  isPartialApproval({ ...RANGE, status: 'approved',
    approvedDates: ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25'] }), false);
eq('legacy approval (no field) → NOT partial',
  isPartialApproval({ ...RANGE, status: 'approved' }), false);
eq('empty approvedDates → NOT partial',
  isPartialApproval({ ...RANGE, status: 'approved', approvedDates: [] }), false);
eq('pending with approvedDates → NOT partial',
  isPartialApproval({ ...RANGE, status: 'pending', approvedDates: ['2026-07-21'] }), false);
eq('rejected with approvedDates → NOT partial',
  isPartialApproval({ ...RANGE, status: 'rejected', approvedDates: ['2026-07-21'] }), false);
eq('out-of-range extras cannot inflate the count past the range',
  isPartialApproval({ ...RANGE, status: 'approved',
    approvedDates: ['2026-07-21', '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'] }), true);

console.log('\nSunday flagging:');
eq('2026-07-26 is a Sunday', isSunday('2026-07-26'), true);
eq('2026-07-25 is not', isSunday('2026-07-25'), false);
eq('2026-07-21 is not', isSunday('2026-07-21'), false);

console.log('\nFormatting:');
eq('day label', formatDayLabel('2026-07-21'), 'Tue 21 Jul');
eq('short list, one month', formatDatesShort(['2026-07-21', '2026-07-22', '2026-07-24']), '21, 22, 24 Jul');
eq('short list across months', formatDatesShort(['2026-07-30', '2026-07-31', '2026-08-01']), '30, 31 Jul, 1 Aug');
eq('empty list', formatDatesShort([]), '');

console.log('\nNotification message:');
eq('names granted AND expected days',
  partialApprovalMessage({ ...RANGE, status: 'approved', approvedDates: ['2026-07-21', '2026-07-22', '2026-07-24'] }),
  { title: 'Leave partially approved',
    body: '3 of your 5 requested days were approved: 21, 22, 24 Jul. You are expected at work on 23, 25 Jul.' });

console.log('\nCancellation — the second overlay:');
const APPROVED = { ...RANGE, status: 'approved' };
eq('no cancelledDates → nothing cancelled', cancelledDates(APPROVED), []);
eq('empty cancelledDates → nothing cancelled (NOT the approvedDates rule)',
  cancelledDates({ ...APPROVED, cancelledDates: [] }), []);
eq('cancelled day is recorded',
  cancelledDates({ ...APPROVED, cancelledDates: ['2026-07-23'] }), ['2026-07-23']);
eq('cancelled days come back sorted',
  cancelledDates({ ...APPROVED, cancelledDates: ['2026-07-24', '2026-07-22'] }),
  ['2026-07-22', '2026-07-24']);
eq('a date outside the requested range cannot be cancelled',
  cancelledDates({ ...APPROVED, cancelledDates: ['2026-08-09'] }), []);
eq('a never-granted date cannot be cancelled',
  cancelledDates({ ...APPROVED, approvedDates: ['2026-07-21'], cancelledDates: ['2026-07-23'] }), []);

eq('effective = granted minus cancelled (full-range grant)',
  effectiveGrantedDates({ ...APPROVED, cancelledDates: ['2026-07-23'] }),
  ['2026-07-21', '2026-07-22', '2026-07-24', '2026-07-25']);
eq('effective = granted minus cancelled (partial grant)',
  effectiveGrantedDates({ ...APPROVED, approvedDates: ['2026-07-21', '2026-07-22', '2026-07-24'],
    cancelledDates: ['2026-07-22'] }),
  ['2026-07-21', '2026-07-24']);
eq('cancelling everything leaves nothing effective',
  effectiveGrantedDates({ ...APPROVED,
    cancelledDates: ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25'] }), []);
eq('effective count after one cancellation',
  effectiveGrantedDayCount({ ...APPROVED, cancelledDates: ['2026-07-23'] }), 4);
eq('effective count with nothing cancelled matches granted',
  effectiveGrantedDayCount(APPROVED), 5);

// The original grant is a RECORD and must never shrink — a cancellation adds an
// overlay, it does not rewrite what the approver decided.
eq('grantedDates is untouched by a cancellation',
  grantedDates({ ...APPROVED, cancelledDates: ['2026-07-23'] }),
  ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25']);
eq('isPartialApproval is untouched by a cancellation',
  isPartialApproval({ ...APPROVED, cancelledDates: ['2026-07-23'] }), false);

eq('isCancelled false when nothing cancelled', isCancelled(APPROVED), false);
eq('isCancelled true after a cancellation',
  isCancelled({ ...APPROVED, cancelledDates: ['2026-07-23'] }), true);
eq('isPartiallyCancelled true when some days survive',
  isPartiallyCancelled({ ...APPROVED, cancelledDates: ['2026-07-23'] }), true);
eq('isPartiallyCancelled false when every day is cancelled',
  isPartiallyCancelled({ ...APPROVED,
    cancelledDates: ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25'] }), false);

console.log('\nCancellation notification:');
eq('names the cancelled days AND what survives',
  leaveCancelledMessage(APPROVED, ['2026-07-23', '2026-07-25']),
  { title: 'Leave partially cancelled',
    body: '2 approved leave days have been cancelled: 23, 25 Jul. You are expected at work on those days. Your remaining approved leave: 21, 22, 24 Jul.' });
eq('singular wording for a single day',
  leaveCancelledMessage(APPROVED, ['2026-07-23']),
  { title: 'Leave partially cancelled',
    body: '1 approved leave day has been cancelled: 23 Jul. You are expected at work on that day. Your remaining approved leave: 21, 22, 24, 25 Jul.' });
eq('full cancellation says nothing is left',
  leaveCancelledMessage(APPROVED, ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25']),
  { title: 'Leave cancelled',
    body: '5 approved leave days have been cancelled: 21, 22, 23, 24, 25 Jul. You are expected at work on those days. You have no approved leave days left on this request.' });
// The caller passes the pre-cancel leave plus the dates just revoked, so the message
// must not depend on `cancelledDates` already being written back to the document.
eq('message reads only cancelledNow, not the stored field',
  leaveCancelledMessage({ ...APPROVED, cancelledDates: ['2026-07-23'] }, ['2026-07-23']).body,
  leaveCancelledMessage(APPROVED, ['2026-07-23']).body);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
