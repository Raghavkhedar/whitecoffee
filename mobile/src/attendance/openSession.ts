// Is any check-in session still open today, across BOTH flows? A sales user can have office
// and field events on the same day, and each screen's state machine only sees its own family —
// so home_out is additionally refused here while anything is open. An unclosed office_in /
// site_in / market_in leaves no closing punch and scores LNF (half pay).
const PAIRS: [string, string][] = [
  ['office_in', 'office_out'],
  ['site_in', 'site_out'],
  ['market_in', 'market_out'],
];

export function hasOpenSession(events: { type: string }[]): boolean {
  return PAIRS.some(([inType, outType]) => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === inType) return true;
      if (events[i].type === outType) return false;
    }
    return false;
  });
}
