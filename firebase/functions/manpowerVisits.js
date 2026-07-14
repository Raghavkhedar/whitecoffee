"use strict";

// Pure builder for the Site Manpower Time Utilisation report (spec:
// docs/superpowers/specs/2026-07-13-site-manpower-utilisation-report-design.md).
// Firestore-free so it can be unit-tested with node --test. index.js reduces each
// ops site_in/site_out attendance event to the plain shape below (IST minute-of-day
// + the admin-filled classification fields) and calls buildManpowerVisits().

const MINUTES_PER_DAY_UNIT = 480; // 8h workday — on-site time is a fraction of this

// Round to 4 dp without floating-point trailing noise.
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

// site_in value wins; fall back to the paired site_out when it is empty.
function firstNonEmpty(a, b) {
  const av = (a == null ? "" : String(a)).trim();
  return av || (b == null ? "" : String(b)).trim();
}
function firstNonEmptyArr(a, b) {
  if (Array.isArray(a) && a.length) return a;
  if (Array.isArray(b) && b.length) return b;
  return [];
}

/**
 * Build per-visit rows for one ops technician on one day.
 *
 * @param {Array<{type:string, min:number, siteName?:string, siteId?:string,
 *                visitType?:string, workDone?:string[]}>} events
 *   site_in / site_out events, ALREADY sorted chronologically. `min` = IST
 *   minute-of-day. Other event types are ignored.
 * @returns {Array<{siteName:string, siteId:string, visitType:string,
 *                  workDone:string[], timeFraction:number|null, otTarget:boolean}>}
 */
function buildManpowerVisits(events) {
  const visits = [];       // emitted rows (carry a private outMin until the end)
  const openIns = [];      // unmatched site_in events, FIFO

  for (const e of events || []) {
    if (e.type === "site_in") {
      openIns.push(e);
    } else if (e.type === "site_out") {
      if (openIns.length === 0) continue;            // orphan logout → skip
      const inEv = openIns.shift();
      const outMin = e.min;
      const timeFraction =
        (typeof inEv.min === "number" && typeof outMin === "number" && outMin > inEv.min)
          ? round4((outMin - inEv.min) / MINUTES_PER_DAY_UNIT)
          : null;
      visits.push({
        siteName:  firstNonEmpty(inEv.siteName, e.siteName),
        siteId:    firstNonEmpty(inEv.siteId, e.siteId),
        visitType: firstNonEmpty(inEv.visitType, e.visitType),
        workDone:  firstNonEmptyArr(inEv.workDone, e.workDone),
        timeFraction,
        outMin: (typeof outMin === "number") ? outMin : null,
        otTarget: false,
      });
    }
  }

  // Missed logout: any still-open site_in → row with blank time, no departure.
  for (const inEv of openIns) {
    visits.push({
      siteName:  firstNonEmpty(inEv.siteName, ""),
      siteId:    firstNonEmpty(inEv.siteId, ""),
      visitType: firstNonEmpty(inEv.visitType, ""),
      workDone:  firstNonEmptyArr(inEv.workDone, []),
      timeFraction: null,
      outMin: null,
      otTarget: false,
    });
  }

  // The day's OT is earned by staying past shift end — during the visit with the
  // latest departure. Flag it; if no visit has a departure (all missed logouts),
  // the last-emitted visit carries it so the day's OT still lands somewhere.
  if (visits.length) {
    let target = -1, best = -Infinity;
    visits.forEach((v, i) => {
      if (v.outMin != null && v.outMin > best) { best = v.outMin; target = i; }
    });
    if (target === -1) target = visits.length - 1;
    visits[target].otTarget = true;
  }

  return visits.map(({ outMin, ...rest }) => rest); // drop the private outMin
}

module.exports = { buildManpowerVisits, round4 };
