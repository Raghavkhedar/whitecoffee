// Pure builders for the attendance punch document, kept free of Firebase imports so they can be
// unit-tested. Parity target: Android's AttendanceRecord.toMap() + withAuditStamp — the backend
// (onPunchWritten, the nightly scorer, exportToSheets, the rules) reads raw documents and does
// not know which client wrote them.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * The IST calendar date for an instant, `yyyy-MM-dd`. The server scores and re-dates punches in
 * IST (onPunchWritten corrects a wrong `date`), so a phone set to another zone must not write —
 * or query for — its own local date: the query would lose the corrected punch and the state
 * machine would reset. Shifts by +05:30 and reads the UTC fields, the same technique the
 * functions use (root CLAUDE.md).
 */
export function istDateString(epochMs: number): string {
  return new Date(epochMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export interface PunchIdentity {
  uid: string;
  employeeId: string;
  name: string;
}

export interface PunchFields {
  type: string;
  latitude: number;
  longitude: number;
  isMockLocation: boolean;
  siteId?: string;
  siteName?: string;
  marketName?: string;
  locationName?: string;
}

/**
 * Every key Android writes, always present — optional text fields default to "" exactly like
 * AttendanceRecord's defaults — plus the audit stamp. `timestamp` / `lastModifiedAt` are passed
 * in (a Firestore Timestamp in production) so this stays pure. `actorUid` must be the signed-in
 * auth uid: the rules deny a `lastModifiedBy` that isn't the caller.
 */
export function buildPunchPayload<T>(
  user: PunchIdentity,
  fields: PunchFields,
  date: string,
  timestamp: T,
  actorUid: string,
) {
  return {
    userId: user.uid,
    employeeId: user.employeeId,
    userName: user.name,
    date,
    type: fields.type,
    timestamp,
    latitude: fields.latitude,
    longitude: fields.longitude,
    siteId: fields.siteId ?? '',
    siteName: fields.siteName ?? '',
    marketName: fields.marketName ?? '',
    locationName: fields.locationName ?? '',
    isMockLocation: fields.isMockLocation,
    lastModifiedBy: actorUid,
    lastModifiedAt: timestamp,
  };
}
