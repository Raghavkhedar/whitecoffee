import { hasOpenSession } from './openSession';

const t = (...types: string[]) => types.map((type) => ({ type }));

describe('hasOpenSession', () => {
  it('is false for an empty day or home_in only', () => {
    expect(hasOpenSession([])).toBe(false);
    expect(hasOpenSession(t('home_in'))).toBe(false);
  });

  it('is true while any in has no later out', () => {
    expect(hasOpenSession(t('home_in', 'office_in'))).toBe(true);
    expect(hasOpenSession(t('home_in', 'site_in'))).toBe(true);
    expect(hasOpenSession(t('home_in', 'market_in'))).toBe(true);
  });

  it('is false once every in is closed', () => {
    expect(hasOpenSession(t('home_in', 'office_in', 'office_out', 'site_in', 'site_out'))).toBe(false);
  });

  it('sees an office session left open under later field events (sales mixed day)', () => {
    expect(hasOpenSession(t('home_in', 'office_in', 'site_in', 'site_out'))).toBe(true);
  });
});
