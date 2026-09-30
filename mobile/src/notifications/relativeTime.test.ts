import { relativeTime } from './relativeTime';

const now = new Date(2026, 8, 30, 15, 0).getTime();

describe('relativeTime', () => {
  it('recent', () => {
    expect(relativeTime(now - 10_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
  });
  it('yesterday and older', () => {
    expect(relativeTime(new Date(2026, 8, 29, 23, 0).getTime(), now)).toBe('Yesterday');
    expect(relativeTime(new Date(2026, 8, 12, 9, 0).getTime(), now)).toBe('12 Sep');
    expect(relativeTime(new Date(2025, 11, 31, 9, 0).getTime(), now)).toBe('31 Dec 2025');
  });
});
