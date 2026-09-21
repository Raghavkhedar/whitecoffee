"use strict";

// Wraps the nightly scheduled handler so a run that never finishes is DETECTABLE and a run that
// throws is still retried for the right date. See nightlyClock.js for why the date comes from the
// scheduled time; see docs/superpowers/specs/2026-09-21-transactional-nightly-and-cancel-design.md
// §1.3b / §6 Q1 for the bug this closes.
//
//   1. resolve the date from event.scheduleTime (refuse a stale/future one — write a failure
//      record and throw, the handler never runs);
//   2. write a `started` marker to system/nightly_runs/{jobName}/{today} BEFORE any work, so a run
//      that dies mid-way is "a doc with startedAt but no ranAt" instead of "no doc at all" — the
//      absence of a document was the state nothing could alarm on. Best-effort: scoring outranks
//      the marker, so a failed marker write is logged and the run continues;
//   3. run the handler with ({ today, startedAt, clockSource }) — the handler's final summary
//      reuses startedAt/clockSource;
//   4. if the handler throws, write { ok:false, error, failedAt } (best-effort, never masks the
//      original error) and RE-THROW the original so the scheduler retries.
//
// All writes use merge:true, so they add to (never replace) whatever the run already recorded.

const { resolveNightlyClock } = require("./nightlyClock");

const errorMessage = (err) => String((err && err.message) || err);

function withNightlyGuard({ getDb, Timestamp, log, now = Date.now, jobName }) {
  const docPath = (date) => `system/nightly_runs/${jobName}/${date}`;

  // Best-effort failure record. Its own try/catch so it can never replace the real error.
  const recordFailure = async (date, message) => {
    try {
      await getDb().doc(docPath(date)).set(
        { ok: false, error: message, failedAt: Timestamp.now() },
        { merge: true }
      );
    } catch (writeErr) {
      log.error(`${jobName}: could not write the failure record for ${date}:`, writeErr);
    }
  };

  return (handler) => async (event) => {
    const scheduleTime = event && event.scheduleTime;
    const clock = resolveNightlyClock({ scheduleTime, nowMs: now() });

    if (clock.refuse) {
      // No trustworthy date to key a record on, so key it on the scheduled date if we can read
      // one; otherwise fall back to the wall-clock date so the failure is still visible somewhere.
      const message = `refused to run: ${clock.reason}`;
      log.error(`${jobName}: ${message}`);
      const fallback = resolveNightlyClock({ scheduleTime: "", nowMs: now() });
      await recordFailure(fallback.today, message);
      throw new Error(`${jobName} ${message}`);
    }

    const { today, source: clockSource } = clock;
    const startedAt = Timestamp.now();

    try {
      await getDb().doc(docPath(today)).set(
        {
          date: today,
          startedAt,
          clockSource,
          scheduleTime: typeof scheduleTime === "string" ? scheduleTime : null,
        },
        { merge: true }
      );
    } catch (markerErr) {
      log.error(`${jobName}: could not write the started marker for ${today} (continuing — scoring outranks the marker):`, markerErr);
    }

    try {
      return await handler(event, { today, startedAt, clockSource });
    } catch (err) {
      log.error(`${jobName}: run for ${today} FAILED — the scheduler will retry it:`, err);
      await recordFailure(today, errorMessage(err));
      throw err;
    }
  };
}

module.exports = { withNightlyGuard };
