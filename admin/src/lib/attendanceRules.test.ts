// Parity + unit tests for the portal's copy of the attendance rule.
// Run: npx tsx src/lib/attendanceRules.test.ts
//
// The `classify` cases are NOT written here. They are loaded from
// firebase/functions/attendance-rule-cases.txt — the same file read by
// firebase/functions/attendanceRules.test.js (payroll) and
// android/…/AttendanceStatusRulesTest.kt (app preview). All three copies of the rule are asserted
// against one set of cases, so a change to one alone turns the others red. See that file's header
// for why the copies can't just be merged.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, resolveOpsWindow, toMinutes, OFFICE_START_MIN, OFFICE_END_MIN } from './attendanceRules';

let passed = 0;
let failed = 0;

function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    passed++;
  } else {
    failed++;
    console.error(`❌ ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  }
}

// Resolved from this file's own location, not process.cwd(), so the suite doesn't silently
// depend on which directory it happens to be run from.
const HERE = dirname(fileURLToPath(import.meta.url));
const CASE_FILE = resolve(HERE, '../../../firebase/functions/attendance-rule-cases.txt');

interface Case {
  name: string;
  inMin: number;
  outMin: number | null;
  startMin: number;
  endMin: number;
  expected: string;
}

const sharedCases: Case[] = readFileSync(CASE_FILE, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((line) => {
    const [name, inMin, outMin, startMin, endMin, expected] = line.split('|').map((s) => s.trim());
    return {
      name,
      inMin: Number(inMin),
      outMin: outMin === '-' ? null : Number(outMin),
      startMin: Number(startMin),
      endMin: Number(endMin),
      expected,
    };
  });

// Guards the silent-pass failure mode: a moved or emptied case file must fail loudly rather than
// register zero cases and look green.
if (sharedCases.length < 10) {
  console.error(`❌ expected the shared cases from ${CASE_FILE}, got ${sharedCases.length}`);
  process.exit(1);
}

for (const c of sharedCases) {
  eq(`[shared] ${c.name}`, classify(c.inMin, c.outMin, c.startMin, c.endMin), c.expected);
}

// ── Portal-only: window resolution ───────────────────────────────────────────

eq('resolveOpsWindow: null when either time is missing', resolveOpsWindow(null, '18:00'), null);
eq('resolveOpsWindow: null when either time is blank', resolveOpsWindow('10:00', ''), null);
eq('resolveOpsWindow: parses a real shift', resolveOpsWindow('12:00', '20:00'), {
  startMin: 12 * 60,
  endMin: 20 * 60,
});
// The bug this guards: scored literally, an inverted window clamps both edges to 0 off-minutes,
// so every such day came out Present no matter when the person actually arrived.
eq('resolveOpsWindow: inverted shift falls back to 10:00-18:00', resolveOpsWindow('20:00', '12:00'), {
  startMin: OFFICE_START_MIN,
  endMin: OFFICE_END_MIN,
});
eq('resolveOpsWindow: zero-length shift falls back to 10:00-18:00', resolveOpsWindow('10:00', '10:00'), {
  startMin: OFFICE_START_MIN,
  endMin: OFFICE_END_MIN,
});

eq('toMinutes: parses a valid time', toMinutes('14:30', 0), 14 * 60 + 30);
eq('toMinutes: falls back on null', toMinutes(null, 600), 600);
eq('toMinutes: falls back on blank', toMinutes('', 600), 600);
eq('toMinutes: falls back on garbage', toMinutes('garbage', 600), 600);

console.log(`${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
