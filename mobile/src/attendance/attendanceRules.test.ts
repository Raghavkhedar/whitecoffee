// Jest runs under Node, but this project has no @types/node — declare just what's used.
declare const require: (id: string) => any;
declare const __dirname: string;
const fs: { readFileSync(p: string, enc: string): string } = require('fs');
const path: { join(...parts: string[]): string } = require('path');

interface SharedCase {
  name: string;
  inMin: number;
  outMin: number | null;
  startMin: number;
  endMin: number;
  expected: string;
}
import {
  classify,
  resolveOpsWindow,
  resolveRestDayType,
  resolveTodayStatus,
  scorablePunches,
  toMinutes,
} from './attendanceRules';

const m = (h: number, min = 0) => h * 60 + min;

// ── Shared cases — the same file the functions and Android suites assert against ──────────
const CASE_FILE = path.join(__dirname, '../../../firebase/functions/attendance-rule-cases.txt');
const sharedCases: SharedCase[] = fs
  .readFileSync(CASE_FILE, 'utf8')
  .split('\n')
  .map((l: string) => l.trim())
  .filter((l: string) => l && !l.startsWith('#'))
  .map((line: string) => {
    const [name, inMin, outMin, startMin, endMin, expected] = line.split('|').map((s: string) => s.trim());
    return {
      name,
      inMin: Number(inMin),
      outMin: outMin === '-' ? null : Number(outMin),
      startMin: Number(startMin),
      endMin: Number(endMin),
      expected,
    };
  });

describe('shared classify cases', () => {
  it('file is present and non-empty', () => {
    expect(sharedCases.length).toBeGreaterThanOrEqual(10);
  });
  it.each(sharedCases)('$name', (c: SharedCase) => {
    expect(classify(c.inMin, c.outMin, c.startMin, c.endMin)).toBe(c.expected);
  });
});

describe('ported functions suite', () => {
  it('toMinutes parses and falls back', () => {
    expect(toMinutes('14:30', 0)).toBe(m(14, 30));
    expect(toMinutes(null, 600)).toBe(600);
    expect(toMinutes('', 600)).toBe(600);
    expect(toMinutes('garbage', 600)).toBe(600);
  });

  it('resolveOpsWindow', () => {
    expect(resolveOpsWindow(null, '18:00')).toBeNull();
    expect(resolveOpsWindow('10:00', '')).toBeNull();
    expect(resolveOpsWindow('12:00', '20:00')).toEqual({ startMin: m(12), endMin: m(20) });
    expect(resolveOpsWindow('20:00', '12:00')).toEqual({ startMin: m(10), endMin: m(18) });
  });

  it('resolveRestDayType', () => {
    expect(resolveRestDayType('2026-09-15', false)).toBeNull(); // Tuesday
    expect(resolveRestDayType('2026-09-13', false)).toBe('Sunday');
    expect(resolveRestDayType('2026-09-15', true)).toBe('Holiday');
    expect(resolveRestDayType('2026-09-13', true)).toBe('Holiday');
  });
});

// IST wall-clock → epoch ms, for building events.
const ist = (h: number, min = 0) => Date.UTC(2026, 8, 30, h, min) - 5.5 * 60 * 60 * 1000;
const ev = (type: string, h: number, min = 0) => ({ type, timestamp: ist(h, min) });

describe('scorablePunches', () => {
  it('uses the role in/out types — a sales SITE day scores', () => {
    const p = scorablePunches([ev('home_in', 9), ev('site_in', 9, 50), ev('site_out', 18, 10)], 'sales');
    expect(p).toEqual({ hasCheckIn: true, inMin: m(9, 50), outMin: m(18, 10) });
  });

  it('office types do not count for operations', () => {
    expect(scorablePunches([ev('office_in', 9)], 'operations').hasCheckIn).toBe(false);
  });

  it('an out before a later in (open session) is not the day\'s check-out', () => {
    const p = scorablePunches(
      [ev('office_in', 9, 55), ev('office_out', 13), ev('office_in', 14)],
      'office',
    );
    expect(p.outMin).toBeNull();
  });
});

describe('resolveTodayStatus', () => {
  it('fixed-window role with no arrival is NotCheckedIn; ops is Pending', () => {
    expect(resolveTodayStatus([ev('home_in', 9)], 'office', null)).toBe('NotCheckedIn');
    expect(resolveTodayStatus([ev('home_in', 9)], 'operations', null)).toBe('Pending');
  });

  it('a late arrival is HalfDay immediately, before any check-out', () => {
    expect(resolveTodayStatus([ev('office_in', 10, 1)], 'office', null)).toBe('HalfDay');
  });

  it('on time with no check-out yet is Present', () => {
    expect(resolveTodayStatus([ev('office_in', 9, 59)], 'office', null)).toBe('Present');
  });

  it('early out is SL', () => {
    expect(resolveTodayStatus([ev('office_in', 9, 50), ev('office_out', 17)], 'office', null)).toBe('SL');
  });

  it('ops scores against the planned window, falling back to 10–18', () => {
    const events = [ev('site_in', 11, 30), ev('site_out', 20)];
    expect(resolveTodayStatus(events, 'operations', { startMin: m(12), endMin: m(20) })).toBe('Present');
    expect(resolveTodayStatus(events, 'operations', null)).toBe('HalfDay');
  });

  it('sales ignores a planned window (fixed 10–18)', () => {
    const events = [ev('site_in', 11, 30)];
    expect(resolveTodayStatus(events, 'sales', { startMin: m(12), endMin: m(20) })).toBe('HalfDay');
  });
});
