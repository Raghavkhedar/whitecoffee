export type OfficeEventType = 'home_in' | 'home_out' | 'office_in' | 'office_out';

export interface OfficeAttendanceEvent {
  type: OfficeEventType;
  timestamp: number;
}

export type OfficeState = 'NotStarted' | 'DayStarted' | 'InOffice' | 'DayEnded';

// Exact port of Android's deriveOfficeState (data/model/OfficeAttendanceState.kt): it looks up
// the last home_in and the last office_in/office_out rather than switching on the day's final
// event, so an event type from the OTHER flow (a sales user's site_in/market_in on the same day)
// can never make the state undefined.
export function deriveOfficeState(events: { type: string; timestamp: number }[]): OfficeState {
  // `home_out` is TERMINAL, and terminal means terminal — checked across the whole day, not
  // just at the tail. An out-of-order sync, a second device, or a duplicate event could
  // otherwise land after the day's `home_out` and silently reopen a closed day.
  if (events.some((e) => e.type === 'home_out')) return 'DayEnded';
  if (!events.some((e) => e.type === 'home_in')) return 'NotStarted';
  const lastOffice = [...events].reverse().find((e) => e.type === 'office_in' || e.type === 'office_out');
  return lastOffice?.type === 'office_in' ? 'InOffice' : 'DayStarted';
}

export function isOfficeEventAllowed(state: OfficeState, event: OfficeEventType): boolean {
  switch (event) {
    case 'home_in':
      return state === 'NotStarted';
    case 'office_in':
      return state === 'DayStarted';
    case 'office_out':
      return state === 'InOffice';
    case 'home_out':
      return state === 'DayStarted';
    default:
      return false;
  }
}
