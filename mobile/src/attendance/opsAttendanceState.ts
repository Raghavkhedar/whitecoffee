export type OpsEventType = 'home_in' | 'home_out' | 'site_in' | 'site_out' | 'market_in' | 'market_out';

export interface OpsAttendanceEvent {
  type: OpsEventType;
  timestamp: number;
}

export type OpsState = 'NoRecord' | 'HomeCheckedIn' | 'SiteCheckedIn' | 'MarketCheckedIn' | 'DayComplete';

// Ported from Android's `deriveAttendanceState`/`isEventAllowed`
// (android/app/src/main/java/com/raghav/whitecoffee/data/model/AttendanceRecord.kt),
// verified directly against source, not paraphrase. `home_out` is TERMINAL — checked across
// the whole event list, same reasoning as officeAttendanceState.ts's identical guard: a
// stray/out-of-order event after home_out must not reopen the day.
export function deriveOpsState(events: OpsAttendanceEvent[]): OpsState {
  if (events.length === 0) return 'NoRecord';
  if (events.some((e) => e.type === 'home_out')) return 'DayComplete';
  const last = events[events.length - 1];
  switch (last.type) {
    case 'home_in':
      return 'HomeCheckedIn';
    case 'home_out':
      return 'DayComplete';
    case 'site_in':
      return 'SiteCheckedIn';
    case 'site_out':
      return 'HomeCheckedIn';
    case 'market_in':
      return 'MarketCheckedIn';
    case 'market_out':
      return 'HomeCheckedIn';
  }
}

// market_in is legal from BOTH HomeCheckedIn and SiteCheckedIn — verified directly against
// Android's isEventAllowed, which permits the same. No auto-recording of an implicit
// site_out happens; a market_in fired while SiteCheckedIn is a direct transition, exactly
// mirroring Android's own (slightly quirky) behavior rather than "fixing" it.
export function isOpsEventAllowed(state: OpsState, type: OpsEventType): boolean {
  switch (type) {
    case 'home_in':
      return state === 'NoRecord';
    case 'home_out':
      return state === 'HomeCheckedIn';
    case 'site_in':
      return state === 'HomeCheckedIn';
    case 'site_out':
      return state === 'SiteCheckedIn';
    case 'market_in':
      return state === 'HomeCheckedIn' || state === 'SiteCheckedIn';
    case 'market_out':
      return state === 'MarketCheckedIn';
    default:
      return false;
  }
}
