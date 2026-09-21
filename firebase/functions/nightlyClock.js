"use strict";

// Which IST date does a nightly scheduled run score? Pure — no Firebase, no ambient clock.
//
// computeDailyAttendanceStatus used to derive `today` from the wall clock at invocation time.
// A run that throws is retried by Cloud Scheduler >= 60 s later, i.e. after IST midnight, where
// the wall clock says D+1: date D was never scored and a premature D+1 was scored instead.
// The scheduled time (event.scheduleTime, RFC3339 UTC, from the X-CloudScheduler-ScheduleTime
// header) does not drift with the retry delay — ASSUMING Cloud Scheduler resends the original
// fire's value on a retry. That is an assumption about Cloud Scheduler that has NOT been confirmed
// (the firebase-functions SDK only forwards the header; it says nothing about retries). If it is
// wrong the retry carries its own later time and this degrades to the old wall-clock behaviour.
// Given that assumption, a merely-late run (a retry) scores the SCHEDULED date — that is the repair.
//
// Same IST arithmetic index.js uses everywhere: shift +05:30, then read the ISO date string.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// A scheduleTime older than this is not a retry, it is something stale or corrupt: refuse rather
// than score a bogus date. Cloud Scheduler's own retry window (retryCount 3, backoff <= 4 min)
// is minutes; 48 h leaves ample room for a manual re-run of "last night". This is the ONLY refusal.
const MAX_PAST_MS = 48 * HOUR_MS;
// A scheduleTime further ahead than this is not believed, but it does NOT refuse: a header that
// carried local time with no offset would read as 5.5 h in the future, and refusing would then kill
// the nightly EVERY night — strictly worse than the old wall-clock behaviour. Fall back to the wall
// clock instead (source "future-drift-fallback"; the guard logs it loudly).
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
    return { today: istDate(now), source: "future-drift-fallback", driftMs };
  }
  return { today: istDate(scheduledMs), source: "schedule", driftMs };
}

module.exports = { resolveNightlyClock, MAX_PAST_MS, MAX_FUTURE_MS };
