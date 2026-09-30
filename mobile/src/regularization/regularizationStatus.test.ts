import { classify, deriveTodayLiveStatus, isRestDay, isSunday } from './regularizationStatus';
import type { OfficeAttendanceEvent } from '../attendance/officeAttendanceState';

// Converts an IST wall-clock time into the epoch-ms timestamp `deriveTodayLiveStatus`
// expects (mirroring how attendanceApi.ts stores `Timestamp.now().toMillis()`). The
// specific calendar date is irrelevant — only the IST time-of-day is being tested.
function epochForIstTime(hour: number, minute: number): number {
  const istMs = Date.UTC(2026, 0, 1, hour, minute, 0);
  return istMs - 5.5 * 60 * 60 * 1000;
}

describe('classify', () => {
  it('scores Present when in on time and out on time', () => {
    expect(classify(10 * 60, 18 * 60)).toBe('Present');
  });

  it('scores HalfDay for any lateness, however small', () => {
    expect(classify(10 * 60 + 1, 18 * 60)).toBe('HalfDay');
  });

  it('scores SL for any early-out, however small, when not late', () => {
    expect(classify(10 * 60, 18 * 60 - 1)).toBe('SL');
  });

  it('HalfDay wins when both late-in and early-out apply', () => {
    expect(classify(10 * 60 + 5, 18 * 60 - 5)).toBe('HalfDay');
  });

  it('scores only late-in when outMinutes is null (still in progress)', () => {
    expect(classify(10 * 60 + 1, null)).toBe('HalfDay');
    expect(classify(10 * 60, null)).toBe('Present');
  });

  it('respects a custom window', () => {
    expect(classify(9 * 60, 17 * 60, 9 * 60, 17 * 60)).toBe('Present');
    expect(classify(9 * 60 + 1, 17 * 60, 9 * 60, 17 * 60)).toBe('HalfDay');
  });
});

describe('deriveTodayLiveStatus', () => {
  it('returns null when there are no office_in events yet', () => {
    const events: OfficeAttendanceEvent[] = [{ type: 'home_in', timestamp: epochForIstTime(9, 0) }];
    expect(deriveTodayLiveStatus(events)).toBeNull();
  });

  it('returns null when in and out are both on time', () => {
    const events: OfficeAttendanceEvent[] = [
      { type: 'office_in', timestamp: epochForIstTime(10, 0) },
      { type: 'office_out', timestamp: epochForIstTime(18, 0) },
    ];
    expect(deriveTodayLiveStatus(events)).toBeNull();
  });

  it('returns HalfDay for a late first office_in', () => {
    const events: OfficeAttendanceEvent[] = [
      { type: 'office_in', timestamp: epochForIstTime(10, 30) },
      { type: 'office_out', timestamp: epochForIstTime(18, 0) },
    ];
    expect(deriveTodayLiveStatus(events)).toBe('HalfDay');
  });

  it('returns SL for an early last office_out with an on-time office_in', () => {
    const events: OfficeAttendanceEvent[] = [
      { type: 'office_in', timestamp: epochForIstTime(10, 0) },
      { type: 'office_out', timestamp: epochForIstTime(17, 0) },
    ];
    expect(deriveTodayLiveStatus(events)).toBe('SL');
  });

  it('scores only late-in when checked in but not yet checked out', () => {
    const events: OfficeAttendanceEvent[] = [{ type: 'office_in', timestamp: epochForIstTime(10, 15) }];
    expect(deriveTodayLiveStatus(events)).toBe('HalfDay');
  });

  it('uses the FIRST office_in and LAST office_out when there are multiple', () => {
    const events: OfficeAttendanceEvent[] = [
      { type: 'office_in', timestamp: epochForIstTime(10, 0) },
      { type: 'office_out', timestamp: epochForIstTime(13, 0) },
      { type: 'office_in', timestamp: epochForIstTime(14, 0) },
      { type: 'office_out', timestamp: epochForIstTime(18, 0) },
    ];
    expect(deriveTodayLiveStatus(events)).toBeNull();
  });
});

describe('isSunday', () => {
  it('is true for a known Sunday', () => {
    expect(isSunday('2026-09-27')).toBe(true);
  });

  it('is false for a known weekday', () => {
    expect(isSunday('2026-09-24')).toBe(false);
  });
});

describe('isRestDay', () => {
  it('is true on a Sunday regardless of the holiday flag', () => {
    expect(isRestDay('2026-09-27', false)).toBe(true);
  });

  it('is true on a weekday flagged as a holiday', () => {
    expect(isRestDay('2026-09-24', true)).toBe(true);
  });

  it('is false on an ordinary weekday', () => {
    expect(isRestDay('2026-09-24', false)).toBe(false);
  });
});

describe('deriveTodayLiveStatus by role', () => {
  const at = (type: string, h: number, m: number) => ({ type, timestamp: epochForIstTime(h, m) });

  it('a sales SITE day is regularizable', () => {
    expect(deriveTodayLiveStatus([at('site_in', 10, 20)], 'sales')).toBe('HalfDay');
  });

  it('office punches are invisible to an operations day', () => {
    expect(deriveTodayLiveStatus([at('office_in', 10, 20)], 'operations')).toBeNull();
  });

  it('operations scores against the planned shift', () => {
    const events = [at('site_in', 11, 50), at('site_out', 20, 0)];
    expect(deriveTodayLiveStatus(events, 'operations', { startMin: 12 * 60, endMin: 20 * 60 })).toBeNull();
    expect(deriveTodayLiveStatus(events, 'operations', null)).toBe('HalfDay');
  });

  it('an office day stays unchanged by the default role', () => {
    expect(deriveTodayLiveStatus([at('office_in', 9, 50), at('office_out', 17, 0)])).toBe('SL');
  });
});
