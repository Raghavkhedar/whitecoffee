"use strict";

// Which IST date does a nightly scheduled run score? Pure — no Firebase, no ambient clock.
//
// computeDailyAttendanceStatus used to derive `today` from the wall clock at invocation time.
// A run that throws is retried by Cloud Scheduler >= 60 s later, i.e. after IST midnight, where
// the wall clock says D+1: date D was never scored and a premature D+1 was scored instead.
// The scheduled time (event.scheduleTime, RFC3339 UTC, the SAME across retries of one fire) does
// not drift, so the date is taken from it. A merely-late run (a retry) therefore scores the
// SCHEDULED date — that is the repair.
//
// Same IST arithmetic index.js uses everywhere: shift +05:30, then read the ISO date string.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// A scheduleTime older than this is not a retry, it is something stale or corrupt: refuse rather
// than score a bogus date. Cloud Scheduler's own retry window (retryCount 3, backoff <= 4 min)
// is minutes; 48 h leaves ample room for a manual re-run of "last night".
const MAX_PAST_MS = 48 * HOUR_MS;
// The scheduler never fires early; an hour of clock skew is already generous.
const MAX_FUTURE_MS = 1 * HOUR_MS;

const istDate = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);

// RFC3339-shaped only. Date.parse alone accepts junk like "1" (-> year 2001); such a value must
// fall back to the wall clock, not be believed.
const RFC3339_SHAPE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}/;

function resolveNightlyClock({ scheduleTime, nowMs } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  const scheduledMs =
    typeof scheduleTime === "string" && RFC3339_SHAPE.test(scheduleTime)
      ? Date.parse(scheduleTime)
      : NaN;

  if (!Number.isFinite(scheduledMs)) {
    return { today: istDate(now), source: "wall-clock", driftMs: 0 };
  }

  const driftMs = now - scheduledMs; // positive = the run is late (a retry), negative = early
  if (driftMs > MAX_PAST_MS) {
    return {
      refuse: true, driftMs,
      reason: `scheduleTime ${scheduleTime} is more than 48 h in the past (drift ${driftMs} ms) — refusing to score a stale date`,
    };
  }
  if (-driftMs > MAX_FUTURE_MS) {
    return {
      refuse: true, driftMs,
      reason: `scheduleTime ${scheduleTime} is more than 1 h in the future (drift ${driftMs} ms) — refusing to score a date that has not happened`,
    };
  }
  return { today: istDate(scheduledMs), source: "schedule", driftMs };
}

module.exports = { resolveNightlyClock, MAX_PAST_MS, MAX_FUTURE_MS };
