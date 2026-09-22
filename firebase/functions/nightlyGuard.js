"use strict";

// Wraps the nightly scheduled handler so a run that never finishes is DETECTABLE and a run that
// throws is still retried for the right date. See nightlyClock.js for why the date comes from the
// scheduled time; see docs/superpowers/specs/2026-09-21-transactional-nightly-and-cancel-design.md
// §1.3b / §6 Q1 for the bug this closes.
//
//   1. resolve the date from event.scheduleTime. A scheduleTime more than 48 h in the PAST is
//      refused: a failure record goes on its OWN doc `refused-<wall-clock IST date>` (never the date
//      doc, so a later successful run's clean-up in step 5 cannot erase it) and the run throws, the
//      handler never runs. A scheduleTime more than 1 h in the FUTURE is NOT refused — the clock
//      falls back to the wall-clock date (source "future-drift-fallback") and it is logged loudly;
//   2. write a `started` marker to system/nightly_runs/{jobName}/{today} BEFORE any work, so a run
//      that dies mid-way is "a doc with startedAt but no completedAt" instead of "no doc at all" —
//      the absence of a document was the state nothing could alarm on. It records the clock's
//      source, the raw scheduleTime and driftMs, and deletes any previous run's completedAt so a
//      re-run of an already-completed date is judged afresh. Best-effort: scoring outranks the marker, so a
//      failed marker write is logged and the run continues;
//   3. run the handler with ({ today, startedAt, clockSource }) — the handler's final summary
//      repeats startedAt/clockSource, so it stays self-describing if the marker write failed;
//   4. if the handler throws, write { failed: true, error, failedAt } (best-effort, never masks the
//      original error) and RE-THROW the original so the scheduler retries;
//   5. if the handler succeeds, write { completedAt } and FieldValue.delete() the three failure keys
//      (best-effort, after the handler's own summary write) and return the handler's result.
//      `completedAt` — NOT `ranAt` — is the completion signal: a Sunday/holiday run returns early
//      with no summary, so it has no `ranAt` at all.
//
// `ok` is NEVER written here. It belongs to the handler's own summary (per-user scoring failures,
// working days only); the guard's failure state lives in `failed`/`error`/`failedAt` so the two
// can never fight over one key, and a successful retry can clear the guard's keys without
// touching the handler's.
//
// Alert when a doc in the run collection has: failed == true (a date doc OR a `refused-*` doc),
// OR startedAt but no completedAt after a grace period, OR ok == false (the handler's per-user
// scoring failures).
// All guard writes use merge:true, so they add to whatever the run already recorded. The handler's
// own summary is ALSO a merge (index.js), so the marker's scheduleTime/clockSource/driftMs survive
// on working days; the order of the summary vs the guard's writes is therefore advisory, not
// load-bearing — completedAt is simply written last because it means "finished".

const { resolveNightlyClock } = require("./nightlyClock");

const errorMessage = (err) => String((err && err.message) || err);

function withNightlyGuard({ getDb, Timestamp, FieldValue, log, now = Date.now, jobName }) {
  const docPath = (date) => `system/nightly_runs/${jobName}/${date}`;

  // Best-effort failure record on doc `docId` (`extra` = additional keys). Its own try/catch so it
  // can never replace the real error.
  const recordFailure = async (docId, message, extra = {}) => {
    try {
      await getDb().doc(docPath(docId)).set(
        { ...extra, failed: true, error: message, failedAt: Timestamp.now() },
        { merge: true }
      );
    } catch (writeErr) {
      log.error(`${jobName}: could not write the failure record for ${docId}:`, writeErr);
    }
  };

  return (handler) => async (event) => {
    const scheduleTime = event && event.scheduleTime;
    const clock = resolveNightlyClock({ scheduleTime, nowMs: now() });

    // Unconditional, on EVERY invocation (including a scheduler retry): the raw scheduleTime the
    // platform actually sent, plus what the clock resolved it to. This is the only record that
    // survives a retry to compare against — the started marker below is a `merge:true` write keyed
    // on the resolved date, so a retry overwrites its own scheduleTime field with its own value and
    // the ORIGINAL fire's raw scheduleTime is gone from Firestore by the time anyone looks. The open
    // question (admin/CLAUDE.md: "unconfirmed assumption that Cloud Scheduler resends the original
    // scheduleTime on a retry") can only be answered by diffing this log line across two invocations
    // for the same date the next time a real failure actually retries — nothing here can force that,
    // and deliberately breaking the nightly to manufacture one is not worth the payroll risk.
    log.log(`${jobName}: invoked with scheduleTime=${JSON.stringify(scheduleTime)} -> resolved ${clock.refuse ? `REFUSED (${clock.reason})` : `date=${clock.today} source=${clock.source} driftMs=${clock.driftMs}`}`);

    if (clock.refuse) {
      // A refused run has no trustworthy scheduled date to key a record on, so it is keyed on the
      // WALL-CLOCK IST date, on a doc of its own (`refused-<date>`) rather than the date doc:
      // a later successful run for that date deletes failed/error/failedAt from the date doc and
      // must not be able to erase this record.
      const message = `refused to run: ${clock.reason}`;
      log.error(`${jobName}: ${message}`);
      const wallDate = resolveNightlyClock({ scheduleTime: "", nowMs: now() }).today;
      await recordFailure(`refused-${wallDate}`, message, { date: wallDate, scheduleTime });
      throw new Error(`${jobName} ${message}`);
    }

    const { today, source: clockSource, driftMs } = clock;
    if (clockSource === "future-drift-fallback") {
      log.error(
        `${jobName}: scheduleTime ${scheduleTime} is ${-driftMs} ms IN THE FUTURE (>1 h) — not trusting it; ` +
        `scoring the wall-clock date ${today} instead. Check what the scheduler is actually sending.`
      );
    }
    const startedAt = Timestamp.now();

    try {
      await getDb().doc(docPath(today)).set(
        {
          date: today,
          startedAt,
          clockSource,
          scheduleTime: typeof scheduleTime === "string" ? scheduleTime : null,
          driftMs,
          // A re-run of an already-completed date (duplicate delivery / manual run) must not look
          // finished while it is in flight or if it dies: drop the previous run's completedAt so
          // "startedAt without completedAt" stays a true "unfinished" signal.
          completedAt: FieldValue.delete(),
        },
        { merge: true }
      );
    } catch (markerErr) {
      log.error(`${jobName}: could not write the started marker for ${today} (continuing — scoring outranks the marker):`, markerErr);
    }

    let result;
    try {
      result = await handler(event, { today, startedAt, clockSource });
    } catch (err) {
      log.error(`${jobName}: run for ${today} FAILED — the scheduler will retry it:`, err);
      await recordFailure(today, errorMessage(err));
      throw err;
    }

    // Completion marker, written by the guard so it exists for EVERY successful run — including a
    // Sunday/holiday run whose handler returns early and writes no summary (so no `ranAt`). It goes
    // last, once everything the handler wrote is done. The same write clears any failure record left by an earlier failed attempt of this date —
    // needed for a Sunday/holiday retry, which has no summary set to replace the doc. Best-effort
    // and outside the handler's try/catch: the run already succeeded, so a failed write is logged
    // and can neither throw nor change what the handler returned.
    try {
      await getDb().doc(docPath(today)).set(
        {
          completedAt: Timestamp.now(),
          failed: FieldValue.delete(),
          error: FieldValue.delete(),
          failedAt: FieldValue.delete(),
        },
        { merge: true }
      );
    } catch (completeErr) {
      log.error(`${jobName}: could not write the completedAt marker for ${today} (the run itself succeeded):`, completeErr);
    }
    return result;
  };
}

module.exports = { withNightlyGuard };
