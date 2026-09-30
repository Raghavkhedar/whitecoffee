import { buildTimeline, formatDuration } from './dayTimeline';

const at = (min: number) => Date.UTC(2026, 8, 30, 4, 0) + min * 60000;

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(5 * 60000)).toBe('5m');
    expect(formatDuration(185 * 60000)).toBe('3h 05m');
    expect(formatDuration(-1)).toBe('0m');
  });
});

describe('buildTimeline', () => {
  it('labels an office day and shows where and how long', () => {
    const items = buildTimeline([
      { type: 'home_in', timestamp: at(0) },
      { type: 'office_in', timestamp: at(30), locationName: 'Tower B' },
      { type: 'office_out', timestamp: at(30 + 240) },
      { type: 'home_out', timestamp: at(300) },
    ]);
    expect(items.map((i) => i.title)).toEqual([
      'Started the day from home',
      'Checked in',
      'Checked out',
      'Ended the day — Home Out',
    ]);
    expect(items[1].detail).toBe('At Tower B');
    expect(items[2].detail).toBe('From Tower B');
    expect(items[2].duration).toBe('4h 00m');
    expect(items[3].duration).toBe('5h 00m');
  });

  it('shows site name and id, and pairs each out with its own in', () => {
    const items = buildTimeline([
      { type: 'home_in', timestamp: at(0) },
      { type: 'site_in', timestamp: at(10), siteName: 'Tower B', siteId: 'S-1' },
      { type: 'site_out', timestamp: at(70) },
      { type: 'site_in', timestamp: at(80), siteName: 'Plant 2' },
      { type: 'site_out', timestamp: at(100) },
    ]);
    expect(items[1].detail).toBe('Tower B (S-1)');
    expect(items[2]).toMatchObject({ detail: 'Tower B (S-1)', duration: '1h 00m' });
    expect(items[4]).toMatchObject({ detail: 'Plant 2', duration: '20m' });
  });
});
