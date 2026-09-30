// The day's activity as the employee sees it on the Attendance screen: every punch in order,
// with where it happened and, for a check-out, how long that visit lasted. Pure (tested).

export interface TimelineInput {
  type: string;
  timestamp: number;
  siteId?: string;
  siteName?: string;
  marketName?: string;
  locationName?: string;
}

export interface TimelineItem {
  key: string;
  time: string;
  title: string;
  detail: string;
  /** For a check-out: how long since its matching check-in, e.g. "3h 05m". */
  duration?: string;
  kind: 'start' | 'in' | 'out' | 'end';
}

/** Device-local "h:mm AM" — the wall clock the employee is living on. */
export function formatTime(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return '';
  const d = new Date(epochMs);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

const IN_FOR_OUT: Record<string, string> = {
  office_out: 'office_in',
  site_out: 'site_in',
  market_out: 'market_in',
  home_out: 'home_in',
};

function site(e: TimelineInput): string {
  if (e.siteName && e.siteId) return `${e.siteName} (${e.siteId})`;
  return e.siteName || e.siteId || '';
}

export function buildTimeline(events: TimelineInput[]): TimelineItem[] {
  return events.map((e, i) => {
    let title = e.type;
    let detail = '';
    let kind: TimelineItem['kind'] = 'in';
    switch (e.type) {
      case 'home_in':
        title = 'Started the day from home';
        kind = 'start';
        break;
      case 'office_in':
        title = 'Checked in';
        detail = e.locationName ? `At ${e.locationName}` : '';
        break;
      case 'office_out':
        title = 'Checked out';
        detail = e.locationName ? `From ${e.locationName}` : '';
        kind = 'out';
        break;
      case 'site_in':
        title = 'Checked in at site';
        detail = site(e);
        break;
      case 'site_out':
        title = 'Checked out of site';
        detail = site(e);
        kind = 'out';
        break;
      case 'market_in':
        title = 'Checked in at market';
        detail = e.marketName ?? '';
        break;
      case 'market_out':
        title = 'Checked out of market';
        detail = e.marketName ?? '';
        kind = 'out';
        break;
      case 'home_out':
        title = 'Ended the day — Home Out';
        kind = 'end';
        break;
    }

    let duration: string | undefined;
    const inType = IN_FOR_OUT[e.type];
    if (inType) {
      for (let j = i - 1; j >= 0; j--) {
        if (events[j].type === e.type) break; // an earlier out closed that in already
        if (events[j].type === inType) {
          duration = formatDuration(e.timestamp - events[j].timestamp);
          // The check-out usually has no name of its own; show where the visit was.
          if (!detail) {
            const opener = events[j];
            detail =
              inType === 'office_in' ? (opener.locationName ? `From ${opener.locationName}` : '')
              : inType === 'site_in' ? site(opener)
              : inType === 'market_in' ? opener.marketName ?? ''
              : '';
          }
          break;
        }
      }
    }

    return { key: `${i}-${e.type}-${e.timestamp}`, time: formatTime(e.timestamp), title, detail, duration, kind };
  });
}
