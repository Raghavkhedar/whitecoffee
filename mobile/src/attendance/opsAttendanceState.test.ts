import { deriveOpsState, isOpsEventAllowed, type OpsAttendanceEvent } from './opsAttendanceState';

function ev(type: OpsAttendanceEvent['type'], timestamp: number): OpsAttendanceEvent {
  return { type, timestamp };
}

describe('deriveOpsState', () => {
  it('is NoRecord with no events', () => {
    expect(deriveOpsState([])).toBe('NoRecord');
  });

  it('is HomeCheckedIn after home_in', () => {
    expect(deriveOpsState([ev('home_in', 1)])).toBe('HomeCheckedIn');
  });

  it('is SiteCheckedIn after site_in', () => {
    expect(deriveOpsState([ev('home_in', 1), ev('site_in', 2)])).toBe('SiteCheckedIn');
  });

  it('is HomeCheckedIn after site_out (cycles back)', () => {
    expect(
      deriveOpsState([ev('home_in', 1), ev('site_in', 2), ev('site_out', 3)]),
    ).toBe('HomeCheckedIn');
  });

  it('is MarketCheckedIn after market_in from HomeCheckedIn', () => {
    expect(deriveOpsState([ev('home_in', 1), ev('market_in', 2)])).toBe('MarketCheckedIn');
  });

  it('is MarketCheckedIn after market_in directly from SiteCheckedIn', () => {
    expect(
      deriveOpsState([ev('home_in', 1), ev('site_in', 2), ev('market_in', 3)]),
    ).toBe('MarketCheckedIn');
  });

  it('is HomeCheckedIn after market_out (cycles back)', () => {
    expect(
      deriveOpsState([ev('home_in', 1), ev('market_in', 2), ev('market_out', 3)]),
    ).toBe('HomeCheckedIn');
  });

  it('is SiteCheckedIn again after a second site_in (multi-cycle)', () => {
    expect(
      deriveOpsState([
        ev('home_in', 1),
        ev('site_in', 2),
        ev('site_out', 3),
        ev('site_in', 4),
      ]),
    ).toBe('SiteCheckedIn');
  });

  it('is DayComplete after home_out', () => {
    expect(
      deriveOpsState([ev('home_in', 1), ev('site_in', 2), ev('site_out', 3), ev('home_out', 4)]),
    ).toBe('DayComplete');
  });

  it('stays DayComplete even if a stray event follows home_out (terminal guard)', () => {
    expect(
      deriveOpsState([
        ev('home_in', 1),
        ev('site_in', 2),
        ev('site_out', 3),
        ev('home_out', 4),
        ev('site_in', 5), // stray/out-of-order event — must not reopen the day
      ]),
    ).toBe('DayComplete');
  });
});

describe('isOpsEventAllowed', () => {
  it('allows home_in only from NoRecord', () => {
    expect(isOpsEventAllowed('NoRecord', 'home_in')).toBe(true);
    expect(isOpsEventAllowed('HomeCheckedIn', 'home_in')).toBe(false);
    expect(isOpsEventAllowed('SiteCheckedIn', 'home_in')).toBe(false);
    expect(isOpsEventAllowed('MarketCheckedIn', 'home_in')).toBe(false);
    expect(isOpsEventAllowed('DayComplete', 'home_in')).toBe(false);
  });

  it('allows home_out only from HomeCheckedIn', () => {
    expect(isOpsEventAllowed('HomeCheckedIn', 'home_out')).toBe(true);
    expect(isOpsEventAllowed('SiteCheckedIn', 'home_out')).toBe(false);
    expect(isOpsEventAllowed('MarketCheckedIn', 'home_out')).toBe(false);
    expect(isOpsEventAllowed('NoRecord', 'home_out')).toBe(false);
  });

  it('allows site_in only from HomeCheckedIn', () => {
    expect(isOpsEventAllowed('HomeCheckedIn', 'site_in')).toBe(true);
    expect(isOpsEventAllowed('SiteCheckedIn', 'site_in')).toBe(false);
    expect(isOpsEventAllowed('MarketCheckedIn', 'site_in')).toBe(false);
    expect(isOpsEventAllowed('NoRecord', 'site_in')).toBe(false);
  });

  it('allows site_out only from SiteCheckedIn', () => {
    expect(isOpsEventAllowed('SiteCheckedIn', 'site_out')).toBe(true);
    expect(isOpsEventAllowed('HomeCheckedIn', 'site_out')).toBe(false);
    expect(isOpsEventAllowed('MarketCheckedIn', 'site_out')).toBe(false);
  });

  it('allows market_in from both HomeCheckedIn and SiteCheckedIn', () => {
    expect(isOpsEventAllowed('HomeCheckedIn', 'market_in')).toBe(true);
    expect(isOpsEventAllowed('SiteCheckedIn', 'market_in')).toBe(true);
    expect(isOpsEventAllowed('MarketCheckedIn', 'market_in')).toBe(false);
    expect(isOpsEventAllowed('NoRecord', 'market_in')).toBe(false);
  });

  it('allows market_out only from MarketCheckedIn', () => {
    expect(isOpsEventAllowed('MarketCheckedIn', 'market_out')).toBe(true);
    expect(isOpsEventAllowed('HomeCheckedIn', 'market_out')).toBe(false);
    expect(isOpsEventAllowed('SiteCheckedIn', 'market_out')).toBe(false);
  });
});
