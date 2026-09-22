export type OfficeEventType = 'home_in' | 'home_out' | 'office_in' | 'office_out';

export interface OfficeAttendanceEvent {
  type: OfficeEventType;
  timestamp: number;
}

export type OfficeState = 'NotStarted' | 'DayStarted' | 'InOffice' | 'DayEnded';

export function deriveOfficeState(events: OfficeAttendanceEvent[]): OfficeState {
  if (events.length === 0) return 'NotStarted';
  const last = events[events.length - 1];
  switch (last.type) {
    case 'home_out':
      return 'DayEnded';
    case 'office_in':
      return 'InOffice';
    case 'office_out':
    case 'home_in':
      return 'DayStarted';
  }
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
