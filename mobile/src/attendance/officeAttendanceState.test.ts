import { deriveOfficeState, isOfficeEventAllowed, type OfficeAttendanceEvent } from './officeAttendanceState';

function ev(type: OfficeAttendanceEvent['type'], timestamp: number): OfficeAttendanceEvent {
  return { type, timestamp };
}

describe('deriveOfficeState', () => {
  it('is NotStarted with no events', () => {
    expect(deriveOfficeState([])).toBe('NotStarted');
  });

  it('is DayStarted after home_in', () => {
    expect(deriveOfficeState([ev('home_in', 1)])).toBe('DayStarted');
  });

  it('is InOffice after office_in', () => {
    expect(deriveOfficeState([ev('home_in', 1), ev('office_in', 2)])).toBe('InOffice');
  });

  it('is DayStarted after office_out (cycles back)', () => {
    expect(
      deriveOfficeState([ev('home_in', 1), ev('office_in', 2), ev('office_out', 3)]),
    ).toBe('DayStarted');
  });

  it('is InOffice again after a second office_in (multi-cycle)', () => {
    expect(
      deriveOfficeState([
        ev('home_in', 1),
        ev('office_in', 2),
        ev('office_out', 3),
        ev('office_in', 4),
      ]),
    ).toBe('InOffice');
  });

  it('is DayEnded after home_out', () => {
    expect(
      deriveOfficeState([ev('home_in', 1), ev('office_in', 2), ev('office_out', 3), ev('home_out', 4)]),
    ).toBe('DayEnded');
  });

  it('stays DayEnded even if a stray event follows home_out (terminal guard)', () => {
    expect(
      deriveOfficeState([
        ev('home_in', 1),
        ev('office_in', 2),
        ev('office_out', 3),
        ev('home_out', 4),
        ev('office_in', 5), // stray/out-of-order event — must not reopen the day
      ]),
    ).toBe('DayEnded');
  });
});

describe('isOfficeEventAllowed', () => {
  it('allows home_in only from NotStarted', () => {
    expect(isOfficeEventAllowed('NotStarted', 'home_in')).toBe(true);
    expect(isOfficeEventAllowed('DayStarted', 'home_in')).toBe(false);
    expect(isOfficeEventAllowed('InOffice', 'home_in')).toBe(false);
    expect(isOfficeEventAllowed('DayEnded', 'home_in')).toBe(false);
  });

  it('allows office_in only from DayStarted', () => {
    expect(isOfficeEventAllowed('DayStarted', 'office_in')).toBe(true);
    expect(isOfficeEventAllowed('NotStarted', 'office_in')).toBe(false);
    expect(isOfficeEventAllowed('InOffice', 'office_in')).toBe(false);
    expect(isOfficeEventAllowed('DayEnded', 'office_in')).toBe(false);
  });

  it('allows office_out only from InOffice', () => {
    expect(isOfficeEventAllowed('InOffice', 'office_out')).toBe(true);
    expect(isOfficeEventAllowed('DayStarted', 'office_out')).toBe(false);
  });

  it('allows home_out only from DayStarted, never while InOffice', () => {
    expect(isOfficeEventAllowed('DayStarted', 'home_out')).toBe(true);
    expect(isOfficeEventAllowed('InOffice', 'home_out')).toBe(false);
    expect(isOfficeEventAllowed('NotStarted', 'home_out')).toBe(false);
    expect(isOfficeEventAllowed('DayEnded', 'home_out')).toBe(false);
  });
});

describe('deriveOfficeState with a sales user\'s field events on the same day', () => {
  it('ignores site/market events instead of returning undefined', () => {
    expect(
      deriveOfficeState([
        { type: 'home_in', timestamp: 1 },
        { type: 'site_in', timestamp: 2 },
      ]),
    ).toBe('DayStarted');
  });

  it('stays InOffice when a foreign event follows office_in', () => {
    expect(
      deriveOfficeState([
        { type: 'home_in', timestamp: 1 },
        { type: 'office_in', timestamp: 2 },
        { type: 'market_in', timestamp: 3 },
      ]),
    ).toBe('InOffice');
  });

  it('is NotStarted without a home_in', () => {
    expect(deriveOfficeState([{ type: 'office_in', timestamp: 1 }])).toBe('NotStarted');
  });
});
