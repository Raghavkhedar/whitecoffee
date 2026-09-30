import { accountStatusFrom, isSessionSuperseded, newSessionToken } from './accountStatus';

describe('accountStatusFrom', () => {
  it('is active when the doc or the field is missing', () => {
    expect(accountStatusFrom(undefined)).toEqual({ kind: 'active' });
    expect(accountStatusFrom({})).toEqual({ kind: 'active' });
    expect(accountStatusFrom({ active: true })).toEqual({ kind: 'active' });
  });

  it('only suspends on an explicit false', () => {
    expect(accountStatusFrom({ active: null })).toEqual({ kind: 'active' });
    expect(accountStatusFrom({ active: 'false' })).toEqual({ kind: 'active' });
  });

  it('carries reason and expected return, defaulting to ""', () => {
    expect(accountStatusFrom({ active: false, suspendedReason: 'Site closed', expectedReturn: '2026-10-05' })).toEqual({
      kind: 'suspended',
      reason: 'Site closed',
      expectedReturn: '2026-10-05',
    });
    expect(accountStatusFrom({ active: false })).toEqual({ kind: 'suspended', reason: '', expectedReturn: '' });
  });
});

describe('isSessionSuperseded', () => {
  it('is true only for a non-empty server token that differs from ours', () => {
    expect(isSessionSuperseded('b', 'a')).toBe(true);
    expect(isSessionSuperseded('a', 'a')).toBe(false);
  });

  it('never signs out on an empty or missing server token', () => {
    expect(isSessionSuperseded('', 'a')).toBe(false);
    expect(isSessionSuperseded(undefined, 'a')).toBe(false);
    expect(isSessionSuperseded(null, 'a')).toBe(false);
  });

  it('never signs out a device that has no local token', () => {
    expect(isSessionSuperseded('b', null)).toBe(false);
    expect(isSessionSuperseded('b', '')).toBe(false);
  });
});

describe('newSessionToken', () => {
  it('is v4-shaped and differs between calls', () => {
    const a = newSessionToken();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newSessionToken()).not.toBe(a);
  });
});
