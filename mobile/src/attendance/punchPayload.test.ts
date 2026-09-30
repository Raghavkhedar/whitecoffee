import { buildPunchPayload, istDateString } from './punchPayload';

describe('istDateString', () => {
  it('is the IST date, not the UTC date, just after IST midnight', () => {
    // 2026-09-29T18:45Z = 2026-09-30 00:15 IST
    expect(istDateString(Date.UTC(2026, 8, 29, 18, 45))).toBe('2026-09-30');
  });

  it('is still the previous IST day just before IST midnight', () => {
    // 2026-09-29T18:25Z = 2026-09-29 23:55 IST
    expect(istDateString(Date.UTC(2026, 8, 29, 18, 25))).toBe('2026-09-29');
  });

  it('crosses month and year boundaries', () => {
    expect(istDateString(Date.UTC(2026, 11, 31, 18, 30))).toBe('2027-01-01');
  });
});

describe('buildPunchPayload', () => {
  const user = { uid: 'u1', employeeId: 'E7', name: 'Asha' };
  const ts = { marker: 'ts' };

  it('writes every key Android writes, with "" for absent text fields', () => {
    const p = buildPunchPayload(
      user,
      { type: 'home_in', latitude: 1.5, longitude: 2.5, isMockLocation: false },
      '2026-09-30',
      ts,
      'u1',
    );
    expect(p).toEqual({
      userId: 'u1',
      employeeId: 'E7',
      userName: 'Asha',
      date: '2026-09-30',
      type: 'home_in',
      timestamp: ts,
      latitude: 1.5,
      longitude: 2.5,
      siteId: '',
      siteName: '',
      marketName: '',
      locationName: '',
      isMockLocation: false,
      lastModifiedBy: 'u1',
      lastModifiedAt: ts,
    });
  });

  it('carries site/market/location text and the mock flag through', () => {
    const p = buildPunchPayload(
      user,
      {
        type: 'site_in',
        latitude: 0,
        longitude: 0,
        isMockLocation: true,
        siteId: 'S-12',
        siteName: 'Tower B',
        marketName: 'Lohar Chawl',
        locationName: 'HQ',
      },
      '2026-09-30',
      ts,
      'u1',
    );
    expect(p.siteId).toBe('S-12');
    expect(p.siteName).toBe('Tower B');
    expect(p.marketName).toBe('Lohar Chawl');
    expect(p.locationName).toBe('HQ');
    expect(p.isMockLocation).toBe(true);
  });
});
