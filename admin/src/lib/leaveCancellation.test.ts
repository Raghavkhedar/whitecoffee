// Pins every branch of `cancelLeave`'s per-date loop (src/lib/firestore.ts) as it stood BEFORE the
// decision logic was extracted into leaveCancellation.ts. Expected values were derived by reading
// that original loop, not the extracted module.
// Run: npx tsx src/lib/leaveCancellation.test.ts
import { planLeaveCancellation, resolveCancellingDates, MAX_CANCEL_DATES, cancelCapError, type StatusDocLike, type LeaveCancellationPlan } from './leaveCancellation';
import type { LeaveLike } from './leaveDates';

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}\n      got  ${g}\n      want ${w}`); }
}

// 2026-07-19 is a Sunday. Tue 21 … Mon 27:  21 Tue · 22 Wed · 23 Thu · 24 Fri · 25 Sat · 26 Sun · 27 Mon.
const LEAVE: LeaveLike = { fromDate: '2026-07-21', toDate: '2026-07-25', status: 'approved' };
const WED = '2026-07-22';
const SUN = '2026-07-26';

function plan(
  leave: LeaveLike, dates: string[], statuses: Record<string, StatusDocLike> = {}, holidays: string[] = [],
): LeaveCancellationPlan {
  return planLeaveCancellation({
    leave, datesToCancel: dates,
    statusByDate: new Map(Object.entries(statuses)),
    holidaySet: new Set(holidays),
  });
}

function outcome(
  cancelling: string[], reverts: string[], skippedDates: string[], refundedDays: number, mergedCancelledDates: string[],
): LeaveCancellationPlan {
  return { cancelling, reverts, skippedDates, refundedDays, mergedCancelledDates };
}

// ── Single-date branch table ───────────────────────────────────────────────────────────────
// One granted working day (Wed), one status doc, every combination of status / markedBy / credit.
type Verdict = 'noop' | 'skip' | 'revert' | 'revert+refund';
const OUT: Record<Verdict, LeaveCancellationPlan> = {
  noop:            outcome([WED], [],    [],    0, [WED]),
  skip:            outcome([WED], [],    [WED], 0, [WED]),
  revert:          outcome([WED], [WED], [],    0, [WED]),
  'revert+refund': outcome([WED], [WED], [],    1, [WED]),
};

const table: Array<[string, StatusDocLike | null, Verdict]> = [
  // no doc at all: nothing to undo, and NOT a skip
  ['no doc', null, 'noop'],
  // Sunday / Holiday docs are "nothing to undo", checked BEFORE markedBy (so even admin ones are silent)
  ['Sunday doc, auto', { status: 'Sunday', markedBy: 'auto' }, 'noop'],
  ['Holiday doc, auto', { status: 'Holiday', markedBy: 'auto', salaryCredit: 1 }, 'noop'],
  ['Holiday doc, admin', { status: 'Holiday', markedBy: 'admin' }, 'noop'],
  ['Sunday doc, admin', { status: 'Sunday', markedBy: 'admin' }, 'noop'],
  // non-leave statuses are reported as skipped (an auto Present is "already claimed", not undone)
  ['Present, auto', { status: 'Present', markedBy: 'auto' }, 'skip'],
  ['HalfDay, auto', { status: 'HalfDay', markedBy: 'auto' }, 'skip'],
  ['SL, auto', { status: 'SL', markedBy: 'auto' }, 'skip'],
  ['LNF, auto', { status: 'LNF', markedBy: 'auto' }, 'skip'],
  ['SLNF (retired name), auto', { status: 'SLNF', markedBy: 'auto' }, 'skip'],
  ['Absent, auto', { status: 'Absent', markedBy: 'auto' }, 'skip'],
  ['Absent, admin', { status: 'Absent', markedBy: 'admin' }, 'skip'],
  ['WO, admin', { status: 'WO', markedBy: 'admin' }, 'skip'],
  ['WO, auto', { status: 'WO', markedBy: 'auto' }, 'skip'],
  ['USCHL, admin', { status: 'USCHL', markedBy: 'admin' }, 'skip'],
  ['USCHL, auto (never written, but reachable in data)', { status: 'USCHL', markedBy: 'auto' }, 'skip'],
  ['unknown status string, auto', { status: 'Whatever', markedBy: 'auto' }, 'skip'],
  ['lowercase "schl" is not SCHL', { status: 'schl', markedBy: 'auto', salaryCredit: 1 }, 'skip'],
  // the markedBy gate: an admin decision is never silently rewritten, whatever the status
  ['SCHL credit 1, admin', { status: 'SCHL', markedBy: 'admin', salaryCredit: 1 }, 'skip'],
  ['SCHL credit 0, admin', { status: 'SCHL', markedBy: 'admin', salaryCredit: 0 }, 'skip'],
  ['PL, admin (retired status)', { status: 'PL', markedBy: 'admin' }, 'skip'],
  ['LWP, admin (retired status)', { status: 'LWP', markedBy: 'admin' }, 'skip'],
  ['SCHL, markedBy missing', { status: 'SCHL', salaryCredit: 1 }, 'skip'],
  ['SCHL, markedBy "backfill"', { status: 'SCHL', markedBy: 'backfill', salaryCredit: 1 }, 'skip'],
  // SCHL: refund ONLY when salaryCredit is exactly 1
  ['SCHL credit 1, auto (paid)', { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 }, 'revert+refund'],
  ['SCHL credit 0, auto (unpaid)', { status: 'SCHL', markedBy: 'auto', salaryCredit: 0 }, 'revert'],
  ['SCHL credit missing, auto', { status: 'SCHL', markedBy: 'auto' }, 'revert'],
  ['SCHL credit 2 (not 1), auto', { status: 'SCHL', markedBy: 'auto', salaryCredit: 2 }, 'revert'],
  // PL/LWP were retired at the SCHL/USCHL cutover; the 2026-09-21 migration confirmed zero such
  // docs remain system-wide, so `scoredAsLeave` no longer recognizes them — a stray one (even
  // auto-marked) is now "already claimed", same as a Present or unknown status.
  ['legacy PL, auto (retired status, no longer scoredAsLeave)', { status: 'PL', markedBy: 'auto' }, 'skip'],
  ['legacy PL, auto, salaryCredit 0 (retired status)', { status: 'PL', markedBy: 'auto', salaryCredit: 0 }, 'skip'],
  ['legacy LWP, auto (retired status)', { status: 'LWP', markedBy: 'auto' }, 'skip'],
  ['legacy LWP, auto, salaryCredit 1 (retired status)', { status: 'LWP', markedBy: 'auto', salaryCredit: 1 }, 'skip'],
];

console.log('Single-date branch table:');
for (const [label, doc, verdict] of table) {
  eq(label, plan(LEAVE, [WED], doc ? { [WED]: doc } : {}), OUT[verdict]);
}

// ── Rest days: skipped wholesale, BY DATE ──────────────────────────────────────────────────
console.log('\nRest days (by date, not by doc status):');
const RANGE_WITH_SUN: LeaveLike = { fromDate: '2026-07-24', toDate: '2026-07-27', status: 'approved' }; // Fri Sat Sun Mon
eq('Sunday with a legacy paid-SCHL auto doc is NOT reverted, NOT refunded, NOT reported skipped — but IS cancelled',
  plan(RANGE_WITH_SUN, [SUN], { [SUN]: { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 } }),
  outcome([SUN], [], [], 0, [SUN]));
eq('Sunday with a legacy PL auto doc: same',
  plan(RANGE_WITH_SUN, [SUN], { [SUN]: { status: 'PL', markedBy: 'auto' } }),
  outcome([SUN], [], [], 0, [SUN]));
eq('Sunday with an admin-marked doc: silent, not in skippedDates (a rest day is not an admin claim)',
  plan(RANGE_WITH_SUN, [SUN], { [SUN]: { status: 'Present', markedBy: 'admin' } }),
  outcome([SUN], [], [], 0, [SUN]));
eq('Sunday with a non-leave auto doc: silent too',
  plan(RANGE_WITH_SUN, [SUN], { [SUN]: { status: 'Absent', markedBy: 'auto' } }),
  outcome([SUN], [], [], 0, [SUN]));
eq('Sunday with no doc',
  plan(RANGE_WITH_SUN, [SUN], {}),
  outcome([SUN], [], [], 0, [SUN]));
eq('a holiday on a working day is silent-skipped BY DATE regardless of the doc status (even a retired PL one)',
  plan(LEAVE, [WED], { [WED]: { status: 'PL', markedBy: 'auto' } }, [WED]),
  outcome([WED], [], [], 0, [WED]));
eq('a holiday with a paid-SCHL auto doc: silent-skipped',
  plan(LEAVE, [WED], { [WED]: { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 } }, [WED]),
  outcome([WED], [], [], 0, [WED]));
eq('a holiday with an admin-marked doc: silent, not in skippedDates',
  plan(LEAVE, [WED], { [WED]: { status: 'SCHL', markedBy: 'admin', salaryCredit: 1 } }, [WED]),
  outcome([WED], [], [], 0, [WED]));
eq('a holiday that falls ON a Sunday is still just a rest day',
  plan(RANGE_WITH_SUN, [SUN], { [SUN]: { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 } }, [SUN]),
  outcome([SUN], [], [], 0, [SUN]));
eq('a holiday OUTSIDE the cancelling range does not affect other dates',
  plan(LEAVE, [WED], { [WED]: { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 } }, ['2026-07-23', '2026-08-15']),
  outcome([WED], [WED], [], 1, [WED]));
eq('the day AFTER a Sunday (Mon) is a normal working day',
  plan(RANGE_WITH_SUN, ['2026-07-27'], { '2026-07-27': { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 } }),
  outcome(['2026-07-27'], ['2026-07-27'], [], 1, ['2026-07-27']));
eq('the day BEFORE a Sunday (Sat) is a normal working day',
  plan(RANGE_WITH_SUN, ['2026-07-25'], { '2026-07-25': { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 } }),
  outcome(['2026-07-25'], ['2026-07-25'], [], 1, ['2026-07-25']));

// ── Mixed multi-date lists ─────────────────────────────────────────────────────────────────
console.log('\nMixed multi-date lists:');
const WEEK: LeaveLike = { fromDate: '2026-07-21', toDate: '2026-07-27', status: 'approved' }; // Tue … Mon (26 = Sun)
{
  const statuses: Record<string, StatusDocLike> = {
    '2026-07-21': { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 },   // revert + refund
    '2026-07-22': { status: 'SCHL', markedBy: 'auto', salaryCredit: 0 },   // revert
    '2026-07-23': { status: 'PL',   markedBy: 'auto' },                    // holiday BY DATE → silent skip (retired status, irrelevant here)
    '2026-07-24': { status: 'Present', markedBy: 'auto' },                 // skipped
    // 25 Sat: no doc                                                       // no-op
    '2026-07-26': { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 },   // Sunday → silent skip
    '2026-07-27': { status: 'LWP',  markedBy: 'auto' },                    // retired status: not scoredAsLeave → skipped
  };
  eq('every date of a week, one per branch',
    plan(WEEK, ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27'], statuses, ['2026-07-23']),
    outcome(
      ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27'],
      ['2026-07-21', '2026-07-22'],
      ['2026-07-24', '2026-07-27'],
      1,
      ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27'],
    ));
  eq('the same request, dates supplied unsorted with duplicates: identical plan (output is sorted and deduped)',
    plan(WEEK, ['2026-07-27', '2026-07-21', '2026-07-24', '2026-07-21', '2026-07-22', '2026-07-27', '2026-07-23', '2026-07-26', '2026-07-25'], statuses, ['2026-07-23']),
    outcome(
      ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27'],
      ['2026-07-21', '2026-07-22'],
      ['2026-07-24', '2026-07-27'],
      1,
      ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27'],
    ));
}
eq('refunds add up: 3 paid SCHL = 3; unpaid SCHL adds none, retired PL/LWP are skipped (not scoredAsLeave)',
  plan(WEEK, ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-27'], {
    '2026-07-21': { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 },
    '2026-07-22': { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 },
    '2026-07-23': { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 },
    '2026-07-24': { status: 'PL', markedBy: 'auto' },
    '2026-07-25': { status: 'SCHL', markedBy: 'auto', salaryCredit: 0 },
    '2026-07-27': { status: 'LWP', markedBy: 'auto' },
  }),
  outcome(
    ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-27'],
    ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-25'],
    ['2026-07-24', '2026-07-27'], 3,
    ['2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-27'],
  ));
eq('several skipped dates come back ascending',
  plan(LEAVE, ['2026-07-25', '2026-07-21', '2026-07-23'], {
    '2026-07-21': { status: 'Present', markedBy: 'auto' },
    '2026-07-23': { status: 'SCHL', markedBy: 'admin', salaryCredit: 1 },
    '2026-07-25': { status: 'WO', markedBy: 'admin' },
  }),
  outcome(['2026-07-21', '2026-07-23', '2026-07-25'], [], ['2026-07-21', '2026-07-23', '2026-07-25'], 0,
    ['2026-07-21', '2026-07-23', '2026-07-25']));
eq('status docs for dates that are not being cancelled are ignored',
  plan(LEAVE, [WED], {
    [WED]: { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 },
    '2026-07-23': { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 },
    '2026-07-24': { status: 'Present', markedBy: 'auto' },
  }),
  outcome([WED], [WED], [], 1, [WED]));

// ── What is cancellable: server copy wins over the caller's list ────────────────────────────
console.log('\nSelection (re-derived from the server copy):');
eq('a date outside the leave is dropped',
  plan(LEAVE, [WED, '2026-08-30'], { '2026-08-30': { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 } }),
  outcome([WED], [], [], 0, [WED]));
eq('already-cancelled dates are dropped from cancelling (no double refund) but stay in the merged list',
  plan({ ...LEAVE, cancelledDates: [WED] }, [WED, '2026-07-23'], {
    [WED]: { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 },
    '2026-07-23': { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 },
  }),
  outcome(['2026-07-23'], ['2026-07-23'], [], 1, [WED, '2026-07-23']));
eq('only already-cancelled dates requested: nothing to cancel',
  plan({ ...LEAVE, cancelledDates: [WED] }, [WED], { [WED]: { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 } }),
  outcome([], [], [], 0, [WED]));
eq('a partial approval bounds what can be cancelled (ungranted 22 dropped)',
  plan({ ...LEAVE, approvedDates: ['2026-07-21', '2026-07-23', '2026-07-25'] }, ['2026-07-21', WED, '2026-07-23'], {
    '2026-07-21': { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 },
    [WED]: { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 },
    '2026-07-23': { status: 'SCHL', markedBy: 'auto', salaryCredit: 0 },
  }),
  outcome(['2026-07-21', '2026-07-23'], ['2026-07-21', '2026-07-23'], [], 1, ['2026-07-21', '2026-07-23']));
eq('empty approvedDates means the whole range is granted',
  plan({ ...LEAVE, approvedDates: [] }, ['2026-07-21', '2026-07-25']),
  outcome(['2026-07-21', '2026-07-25'], [], [], 0, ['2026-07-21', '2026-07-25']));
eq('single-day leave (toDate absent), with a retired PL doc (not scoredAsLeave, so skipped)',
  plan({ fromDate: WED, status: 'approved' }, [WED], { [WED]: { status: 'PL', markedBy: 'auto' } }),
  outcome([WED], [], [WED], 0, [WED]));
eq('empty selection: nothing cancelling, merged list is just the existing (sorted) cancellations',
  plan({ ...LEAVE, cancelledDates: ['2026-07-25', '2026-07-21'] }, []),
  outcome([], [], [], 0, ['2026-07-21', '2026-07-25']));
eq('empty selection, no existing cancellations',
  plan(LEAVE, []),
  outcome([], [], [], 0, []));
eq('every requested date is ungranted: cancelling is empty',
  plan(LEAVE, ['2026-09-01', '2026-09-02']),
  outcome([], [], [], 0, []));

// ── mergedCancelledDates: union, deduped, sorted ────────────────────────────────────────────
console.log('\nmergedCancelledDates:');
eq('unions with earlier cancellations and sorts',
  plan({ ...LEAVE, cancelledDates: ['2026-07-25'] }, ['2026-07-21', '2026-07-23']).mergedCancelledDates,
  ['2026-07-21', '2026-07-23', '2026-07-25']);
eq('a duplicate inside the existing list is collapsed',
  plan({ ...LEAVE, cancelledDates: ['2026-07-25', '2026-07-25'] }, [WED]).mergedCancelledDates,
  [WED, '2026-07-25']);
eq('a STRAY existing cancelledDates entry (outside the leave) is preserved verbatim, not pruned',
  plan({ ...LEAVE, cancelledDates: ['2026-08-01'] }, [WED]).mergedCancelledDates,
  [WED, '2026-08-01']);
eq('merged includes skipped and rest-day dates (they are still recorded as cancelled)',
  plan(LEAVE, ['2026-07-21', '2026-07-23'], {
    '2026-07-21': { status: 'Present', markedBy: 'auto' },
  }, ['2026-07-23']).mergedCancelledDates,
  ['2026-07-21', '2026-07-23']);
eq('cancelledDates undefined behaves as empty',
  plan({ fromDate: '2026-07-21', toDate: '2026-07-25' }, [WED]).mergedCancelledDates,
  [WED]);

// ── The leave's own status ─────────────────────────────────────────────────────────────────
// cancelLeave throws 'only an approved leave can be cancelled' BEFORE it derives or reads
// anything; that guard stays in cancelLeave. The extracted planner never looks at `status`.
console.log('\nLeave status (guard stays in cancelLeave):');
eq('planner ignores leave.status — a pending leave plans exactly like an approved one',
  plan({ ...LEAVE, status: 'pending' }, [WED], { [WED]: { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 } }),
  outcome([WED], [WED], [], 1, [WED]));
eq('planner ignores a missing leave.status too',
  plan({ fromDate: LEAVE.fromDate, toDate: LEAVE.toDate }, [WED]),
  outcome([WED], [], [], 0, [WED]));

// ── resolveCancellingDates (what cancelLeave needs BEFORE it reads anything) ───────────────
console.log('\nresolveCancellingDates:');
eq('dedupes, filters to still-granted, sorts',
  resolveCancellingDates({ ...LEAVE, cancelledDates: [WED] }, ['2026-07-25', WED, '2026-07-21', '2026-07-21', '2026-09-09']),
  ['2026-07-21', '2026-07-25']);
eq('empty list', resolveCancellingDates(LEAVE, []), []);

// ── Purity ─────────────────────────────────────────────────────────────────────────────────
console.log('\nPurity:');
{
  const dates = ['2026-07-23', '2026-07-21', '2026-07-21'];
  const statuses = new Map<string, StatusDocLike>([['2026-07-21', { status: 'SCHL', markedBy: 'auto', salaryCredit: 1 }]]);
  const holidays = new Set<string>(['2026-07-23']);
  const leave: LeaveLike = { ...LEAVE, cancelledDates: ['2026-07-25', '2026-07-24'] };
  const before = JSON.stringify([dates, Array.from(statuses), Array.from(holidays), leave]);
  planLeaveCancellation({ leave, datesToCancel: dates, statusByDate: statuses, holidaySet: holidays });
  eq('inputs are not mutated', JSON.stringify([dates, Array.from(statuses), Array.from(holidays), leave]), before);
  const a = planLeaveCancellation({ leave, datesToCancel: dates, statusByDate: statuses, holidaySet: holidays });
  const b = planLeaveCancellation({ leave, datesToCancel: dates, statusByDate: statuses, holidaySet: holidays });
  eq('deterministic on repeat calls', a, b);
}

// ── The per-transaction cap (design §6 Q2) ────────────────────────────────────────────────────
// A cancellation transaction reads 2 docs per date (status + holiday). The client SDK sends every doc
// it READ but did not write as a `verify` entry in the Commit, so the Commit carries ~2N + 2 entries
// (N statuses written-or-verified, N holidays verified, + leave + user) against Firestore's 500-entry
// limit: the ceiling is ~249 dates, NOT the 202 that "one write per date + 2" would suggest. The
// emulator does not enforce that limit, so this arithmetic is the only pin on it.
// The message must tell the admin what to do about it (chunks of at most 200), because the UI shows it verbatim.
{
  eq('MAX_CANCEL_DATES is 200', MAX_CANCEL_DATES, 200);
  eq('the cap keeps the Commit (2N + 2 write/verify entries) under the 500-entry limit', 2 * MAX_CANCEL_DATES + 2 < 500, true);
  eq('0 dates: no cap error (the empty case has its own error)', cancelCapError(0), null);
  eq('1 date: no cap error', cancelCapError(1), null);
  eq('exactly the cap: no cap error', cancelCapError(MAX_CANCEL_DATES), null);
  const over = cancelCapError(MAX_CANCEL_DATES + 1);
  eq('one over the cap: an error', typeof over, 'string');
  eq('the error tells the admin to cancel in chunks of at most 200', /chunks of at most 200 dates/.test(over ?? ''), true);
  eq('the error names how many were selected', /201/.test(over ?? ''), true);
  eq('the error is prefixed like every other cancelLeave error', (over ?? '').startsWith('cancelLeave: '), true);
  eq('a far-over count is still an error', typeof cancelCapError(366), 'string');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
