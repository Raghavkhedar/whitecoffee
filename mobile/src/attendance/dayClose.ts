// What a logout must write to close today — the mobile counterpart of Android's
// CloseOpenDayUseCase / dayClosePath / willLogoutCloseDay (decision #34b).
//
// Decided from the ACTUAL open state of the day's events, never from the role: sales is hybrid,
// and sending a site-checked-in sales user down the office path leaves the site_in unclosed —
// the nightly compute scores that as LNF (half pay). Unlike Android, which picks ONE path, this
// closes every open session across both flows, so a sales day with both an office and a field
// session can't be left half-open either. Pure, so the dialog and the write can't disagree.

export interface CloseableEvent {
  type: string;
  siteId?: string;
  siteName?: string;
  marketName?: string;
  locationName?: string;
}

export interface ClosingPunch {
  type: string;
  siteId?: string;
  siteName?: string;
  marketName?: string;
  locationName?: string;
}

const PAIRS: [string, string][] = [
  ['market_in', 'market_out'],
  ['site_in', 'site_out'],
  ['office_in', 'office_out'],
];

/** The punches to write, in order; empty when there's nothing to close. Events sorted ascending. */
export function planDayClose(events: CloseableEvent[]): ClosingPunch[] {
  if (events.some((e) => e.type === 'home_out')) return []; // terminal: the day is already closed
  if (!events.some((e) => e.type === 'home_in')) return []; // never started: nothing to close

  const punches: ClosingPunch[] = [];
  for (const [inType, outType] of PAIRS) {
    // The latest in/out of this pair decides; an in after the last out is still open.
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === outType) break;
      if (e.type === inType) {
        // Carry the open visit's names onto its closing punch, as Android does.
        if (inType === 'site_in') punches.push({ type: outType, siteId: e.siteId, siteName: e.siteName });
        else if (inType === 'market_in') punches.push({ type: outType, marketName: e.marketName });
        else punches.push({ type: outType, locationName: e.locationName });
        break;
      }
    }
  }
  punches.push({ type: 'home_out' });
  return punches;
}

/** Human summary for the confirmation dialog. */
export function describeDayClose(plan: ClosingPunch[]): string {
  const names: Record<string, string> = {
    office_out: 'Office Out',
    site_out: 'Site Out',
    market_out: 'Market Out',
    home_out: 'Home Out',
  };
  return plan.map((p) => names[p.type] ?? p.type).join(' → ');
}
