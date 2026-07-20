"use strict";

/**
 * Punch integrity — server-side verdict on a client-written attendance event.
 *
 * WHY THIS IS DETECTION AND NOT PREVENTION: attendance punches must keep working
 * OFFLINE. AttendanceRepository writes through the Firestore SDK without awaiting, so a
 * punch made at a site with no signal is cached locally and synced later. Routing punches
 * through a callable would require connectivity and would LOSE those punches. So the
 * client write stays, security rules bound it (type allowlist, timestamp window, shape),
 * and this module scores what lands — nothing is ever rejected or deleted here.
 *
 * The trigger that calls this uses the Admin SDK and bypasses rules, so it can correct the
 * `date` field: rules cannot do timezone arithmetic, and the nightly scorer queries by
 * `date`, so a client that sends a real timestamp with a forged `date` would otherwise
 * attribute the punch to a different day.
 *
 * Pure and Firestore-free so it can be unit-tested with `node --test`.
 */

/** Metres per degree of latitude (close enough for a geofence check). */
const M_PER_DEG_LAT = 111320;

/** Default geofence radius in metres when a site does not define one. */
const DEFAULT_GEOFENCE_M = 200;

/** Client/server clock skew beyond which a punch is worth flagging, in minutes. */
const SKEW_FLAG_MINUTES = 15;

/**
 * IST calendar date ("yyyy-mm-dd") for an epoch-millis instant.
 *
 * Cloud functions run on a UTC clock (see root CLAUDE.md): shift by +05:30 and read the
 * UTC parts. Never use bare local-time getters here.
 *
 * @param {number} epochMillis
 * @returns {string} "yyyy-mm-dd"
 */
function istDateOf(epochMillis) {
  const shifted = new Date(epochMillis + 5.5 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Great-circle-ish distance in metres between two lat/lng points.
 * Equirectangular approximation — accurate well within a metre at geofence scale, and
 * far cheaper than haversine.
 */
function distanceMetres(lat1, lng1, lat2, lng2) {
  const latRad = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dLat = (lat2 - lat1) * M_PER_DEG_LAT;
  const dLng = (lng2 - lng1) * M_PER_DEG_LAT * Math.cos(latRad);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

/**
 * Assess a punch. Returns the patch to apply to the document — never a rejection.
 *
 * @param {object} punch      the written attendance event
 * @param {number} receivedAt server receipt time, epoch millis (the TRUSTED clock)
 * @param {object|null} site  the site doc when the punch names one (lat/lng/radiusM)
 * @returns {{date?:string, integrity:object}} patch; `date` present only when it needs
 *          correcting, so an unchanged punch is not rewritten
 */
function assessPunch(punch, receivedAt, site) {
  const flags = [];
  const clientMillis = toMillis(punch && punch.timestamp);

  // 1. Clock skew — the gap between when the client says it happened and when the server
  //    saw it. A large gap is normal for an offline punch, so this is informational, not
  //    an accusation; it is the raw signal an investigator needs.
  const skewMin = clientMillis === null ? null
    : Math.round((receivedAt - clientMillis) / 60000);
  if (skewMin !== null && Math.abs(skewMin) > SKEW_FLAG_MINUTES) {
    flags.push(skewMin > 0 ? "delayed_sync" : "future_timestamp");
  }

  // 2. Date correction — the scorer queries by `date`, so a forged `date` reassigns the
  //    punch to another day regardless of a truthful timestamp. Recomputed from the
  //    client timestamp (already bounded by the rules) and corrected in place.
  const patch = { integrity: {} };
  if (clientMillis !== null) {
    const trueDate = istDateOf(clientMillis);
    if (punch.date !== trueDate) {
      flags.push("date_mismatch");
      patch.date = trueDate;
    }
  }

  // 3. Geofence — recorded and flagged, NEVER rejected. GPS drifts indoors, and a site's
  //    stored coordinates may simply be wrong; refusing the punch would cost a real
  //    employee a real day's pay.
  let distanceM = null;
  if (site && isNum(site.latitude) && isNum(site.longitude)
      && isNum(punch.latitude) && isNum(punch.longitude)) {
    distanceM = Math.round(distanceMetres(punch.latitude, punch.longitude, site.latitude, site.longitude));
    const radius = isNum(site.radiusM) ? site.radiusM : DEFAULT_GEOFENCE_M;
    if (distanceM > radius) flags.push("outside_geofence");
  }

  // 4. Mock location — the app reports Android's isFromMockProvider. Absent on older
  //    app versions, which is NOT itself suspicious; only an explicit true is.
  if (punch && punch.isMockLocation === true) flags.push("mock_location");

  patch.integrity = {
    checkedAt: new Date(receivedAt).toISOString(),
    serverReceivedAt: receivedAt,
    clockSkewMinutes: skewMin,
    distanceM,
    flags,
    trusted: flags.length === 0,
  };
  return patch;
}

function isNum(v) { return typeof v === "number" && isFinite(v); }

/** Firestore Timestamp | Date | epoch millis → epoch millis, or null. */
function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "number" && isFinite(ts)) return ts;
  if (isNum(ts._seconds)) return ts._seconds * 1000;
  if (isNum(ts.seconds)) return ts.seconds * 1000;
  return null;
}

module.exports = {
  assessPunch, istDateOf, distanceMetres, toMillis,
  DEFAULT_GEOFENCE_M, SKEW_FLAG_MINUTES,
};
