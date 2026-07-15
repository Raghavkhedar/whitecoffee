// Pure port of the Android app's deriveAttendanceState (AttendanceRecord.kt).
//
// The phone derives an employee's live check-in/out state purely from the LAST event
// in their ordered list of today's punches. The Daily Activity page reuses that same
// logic to preview what state an employee will be in after an admin "restore to here"
// removes the trailing punches — so the admin sees exactly where they're rewinding to
// ("→ At Site: Acme") before confirming. Keep this in sync with the Kotlin source.
import type { AttendanceRecord } from '@/types';

export type DerivedStateKind =
  | 'NoRecord'      // nothing recorded yet
  | 'HomeCheckedIn' // at home between visits (can start a site/market or end the day)
  | 'SiteCheckedIn' // currently checked in at a site
  | 'MarketCheckedIn'
  | 'AtOffice'      // office/admin checked in
  | 'DayComplete';  // checked out for the day (the terminal state a bad logout traps)

export interface DerivedState {
  kind: DerivedStateKind;
  label: string;
  /** The event that determined this state (the last punch), if any. */
  lastEvent?: AttendanceRecord;
}

// Ascending timestamp helper (records may carry a Firestore Timestamp with `.seconds`).
function tsSecs(e: AttendanceRecord): number {
  return (e.timestamp as unknown as { seconds: number })?.seconds ?? 0;
}

/**
 * Derive the check-in/out state implied by an event list. Sorts defensively by
 * timestamp and reads the last event, mirroring deriveAttendanceState on the phone.
 */
export function deriveState(events: AttendanceRecord[]): DerivedState {
  if (events.length === 0) return { kind: 'NoRecord', label: 'Not checked in' };
  const sorted = [...events].sort((a, b) => tsSecs(a) - tsSecs(b));
  const last = sorted[sorted.length - 1];
  switch (last.type) {
    case 'home_in':
      return { kind: 'HomeCheckedIn', label: 'At Home', lastEvent: last };
    case 'site_out':
    case 'market_out':
      return { kind: 'HomeCheckedIn', label: 'At Home', lastEvent: last };
    case 'site_in':
      return { kind: 'SiteCheckedIn', label: `At Site: ${last.siteName || '—'}`, lastEvent: last };
    case 'market_in':
      return { kind: 'MarketCheckedIn', label: `At Market: ${last.marketName || '—'}`, lastEvent: last };
    case 'office_in':
      return { kind: 'AtOffice', label: 'At Office', lastEvent: last };
    case 'home_out':
    case 'office_out':
      return { kind: 'DayComplete', label: 'Day complete', lastEvent: last };
    default:
      return { kind: 'NoRecord', label: 'Not checked in', lastEvent: last };
  }
}

// Human label for a single punch type, for the timeline rows.
export function eventLabel(type: string): string {
  switch (type) {
    case 'home_in':    return 'Checked in from Home';
    case 'home_out':   return 'Checked out for the day';
    case 'site_in':    return 'Checked in at Site';
    case 'site_out':   return 'Checked out from Site';
    case 'market_in':  return 'Checked in at Market';
    case 'market_out': return 'Checked out from Market';
    case 'office_in':  return 'Office check-in';
    case 'office_out': return 'Office check-out';
    default:           return type;
  }
}
