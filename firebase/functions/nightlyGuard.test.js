"use strict";

// withNightlyGuard — the started marker + failure record around computeDailyAttendanceStatus.
// Run: `npm test`. Uses a recording fake db; the real Firestore write is exercised in production.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { withNightlyGuard } = require("./nightlyGuard");

const JOB = "computeDailyAttendanceStatus";
const HOUR = 60 * 60 * 1000;
const SCHEDULED = "2026-09-21T18:29:00Z"; // 23:59 IST on 2026-09-21
const at = (iso) => Date.parse(iso);

const DELETE = { fakeFieldValueDelete: true }; // the fake FieldValue.delete() sentinel

// The fake db records every set() call AND models the stored doc (Firestore merge semantics, incl.
// FieldValue.delete() removing a key), so a test can assert what a doc ENDS UP containing.
const makeEnv = ({ nowMs = at("2026-09-21T18:29:05Z"), failWhen = () => false, seed = {} } = {}) => {
  const calls = [];
  const docs = new Map(Object.entries(seed));
  const logs = { error: [], log: [] };
  const state = { nowMs };
  const db = {
    doc: (p) => ({
      set: async (data, opts) => {
        if (failWhen(p, data, opts)) throw new Error("firestore write blew up");
        calls.push({ path: p, data, opts });
        const next = opts && opts.merge ? { ...(docs.get(p) || {}) } : {};
        for (const [k, v] of Object.entries(data)) {
          if (v === DELETE) delete next[k]; else next[k] = v;
        }
        docs.set(p, next);
      },
    }),
  };
  const Timestamp = { now: () => ({ fakeTimestamp: state.nowMs }) };
  const FieldValue = { delete: () => DELETE };
  const log = { error: (...a) => logs.error.push(a), log: (...a) => logs.log.push(a) };
  const guard = withNightlyGuard({ getDb: () => db, Timestamp, FieldValue, log, now: () => state.nowMs, jobName: JOB });
  return { guard, calls, logs, state, db, docs };
};

const markerPath = (date) => `system/nightly_runs/${JOB}/${date}`;
const isFailure = (c) => c.data.failed === true;

test("marker is written FIRST, before the handler, with startedAt/clockSource/scheduleTime/driftMs and merge", async () => {
  const env = makeEnv();
  let callsSeenByHandler = null;
  await env.guard(async () => { callsSeenByHandler = env.calls.length; })({ scheduleTime: SCHEDULED });
  assert.equal(callsSeenByHandler, 1, "the marker must already be written when the handler starts");
  const [m] = env.calls;
  assert.equal(m.path, markerPath("2026-09-21"));
  assert.deepEqual(m.opts, { merge: true });
  assert.equal(m.data.date, "2026-09-21");
  assert.deepEqual(m.data.startedAt, { fakeTimestamp: at("2026-09-21T18:29:05Z") });
  assert.equal(m.data.clockSource, "schedule");
  assert.equal(m.data.scheduleTime, SCHEDULED);
  assert.equal(m.data.driftMs, 5000, "now (18:29:05) minus scheduled (18:29:00)");
  assert.equal("ranAt" in m.data, false, "a marker without ranAt is exactly what marks an unfinished run");
});

test("the handler receives { today } from the SCHEDULE plus the marker's startedAt and clockSource", async () => {
  const env = makeEnv();
  let received;
  const event = { scheduleTime: SCHEDULED };
  await env.guard(async (ev, ctx) => { received = { ev, ctx }; })(event);
  assert.equal(received.ev, event);
  assert.equal(received.ctx.today, "2026-09-21");
  assert.equal(received.ctx.clockSource, "schedule");
  assert.deepEqual(received.ctx.startedAt, { fakeTimestamp: at("2026-09-21T18:29:05Z") });
});

test("on success it returns the handler's result and writes no failure record", async () => {
  const env = makeEnv();
  const out = await env.guard(async () => "the-result")({ scheduleTime: SCHEDULED });
  assert.equal(out, "the-result");
  assert.equal(env.calls.length, 2, "the started marker, then the completedAt marker");
  assert.equal(env.calls.some(isFailure), false);
  assert.equal(env.logs.error.length, 0);
});

test("a throwing handler: failure record written (merge), ORIGINAL error re-thrown, error logged", async () => {
  const env = makeEnv();
  const boom = new Error("batch commit exploded");
  await assert.rejects(env.guard(async () => { throw boom; })({ scheduleTime: SCHEDULED }), (e) => e === boom);
  assert.equal(env.calls.length, 2);
  const f = env.calls[1];
  assert.equal(f.path, markerPath("2026-09-21"));
  assert.deepEqual(f.opts, { merge: true });
  assert.equal(f.data.failed, true);
  assert.equal("ok" in f.data, false, "the guard never borrows `ok` — that key belongs to the handler's summary");
  assert.equal(f.data.error, "batch commit exploded");
  assert.ok(f.data.failedAt, "failedAt is set");
  assert.ok(env.logs.error.length >= 1, "an error line is logged");
  assert.ok(env.logs.error.flat().some((x) => String(x).includes("batch commit exploded") || x === boom));
});

test("a non-Error throw is still recorded and re-thrown as-is", async () => {
  const env = makeEnv();
  await assert.rejects(env.guard(async () => { throw "plain string"; })({ scheduleTime: SCHEDULED }), (e) => e === "plain string");
  assert.equal(env.calls[1].data.error, "plain string");
});

test("if the failure-record write itself throws, the ORIGINAL error is still the one re-thrown", async () => {
  const env = makeEnv({ failWhen: (_p, data) => data.failed === true });
  const boom = new Error("original");
  await assert.rejects(env.guard(async () => { throw boom; })({ scheduleTime: SCHEDULED }), (e) => e === boom);
  assert.ok(env.logs.error.length >= 2, "both the handler failure and the failed record write are logged");
});

test("a marker write that throws does not stop the handler (scoring beats the marker)", async () => {
  const env = makeEnv({ failWhen: (_p, data) => "startedAt" in data });
  let ran = false;
  const out = await env.guard(async (_ev, { today }) => { ran = true; return today; })({ scheduleTime: SCHEDULED });
  assert.equal(ran, true);
  assert.equal(out, "2026-09-21");
  assert.ok(env.logs.error.length >= 1, "the failed marker write is logged");
});

const refusedPath = (wallDate) => `system/nightly_runs/${JOB}/refused-${wallDate}`;

test("a refused clock writes a failure record on refused-<wall-clock date>, throws, and never runs the handler", async () => {
  const env = makeEnv({ nowMs: at("2026-09-30T00:00:00Z") }); // 05:30 IST on 09-30
  let ran = false;
  await assert.rejects(env.guard(async () => { ran = true; })({ scheduleTime: SCHEDULED }), /refus/i);
  assert.equal(ran, false);
  assert.equal(env.calls.length, 1, "the refusal record is the only write — no started marker");
  const [failure] = env.calls;
  assert.equal(failure.path, "system/nightly_runs/computeDailyAttendanceStatus/refused-2026-09-30", "exact path pinned");
  assert.notEqual(failure.path, markerPath("2026-09-21"), "never the scheduled date's doc");
  assert.notEqual(failure.path, markerPath("2026-09-30"), "never the wall-clock date's doc either (a later success would clear it)");
  assert.deepEqual(failure.opts, { merge: true });
  assert.equal(failure.data.failed, true);
  assert.equal("ok" in failure.data, false);
  assert.equal(failure.data.date, "2026-09-30", "date is the WALL-CLOCK IST date");
  assert.equal(failure.data.scheduleTime, SCHEDULED, "the raw header is kept");
  assert.match(failure.data.error, /past/i);
  assert.ok(failure.data.failedAt);
  assert.ok(env.logs.error.length >= 1);
});

test("a later successful run's clean-up can never erase a refusal record (they live on different docs)", async () => {
  // Refused on the wall-clock date 2026-09-21, then a normal run for the same date succeeds.
  const env = makeEnv({ nowMs: at("2026-09-21T18:29:05Z") });
  await assert.rejects(env.guard(async () => {})({ scheduleTime: "2026-09-10T18:29:00Z" }), /refus/i);
  await env.guard(async () => {})({ scheduleTime: SCHEDULED });
  const refusal = env.docs.get(refusedPath("2026-09-21"));
  assert.ok(refusal, "refusal doc still exists");
  assert.equal(refusal.failed, true);
  assert.ok(refusal.error && refusal.failedAt);
  const date = env.docs.get(markerPath("2026-09-21"));
  assert.ok(date.completedAt);
  assert.equal("failed" in date, false);
});

test("a scheduleTime more than 1 h in the future does not stop the run: wall-clock date, logged loudly", async () => {
  const env = makeEnv({ nowMs: at("2026-09-21T18:29:00Z") });
  let received;
  const out = await env.guard(async (_e, ctx) => { received = ctx; return "ran"; })({ scheduleTime: "2026-09-21T23:59:00Z" });
  assert.equal(out, "ran");
  assert.equal(received.today, "2026-09-21");
  assert.equal(received.clockSource, "future-drift-fallback");
  assert.equal(env.calls[0].data.clockSource, "future-drift-fallback");
  assert.equal(env.calls[0].data.scheduleTime, "2026-09-21T23:59:00Z");
  assert.equal(env.calls[0].data.driftMs, -5.5 * 60 * 60 * 1000);
  assert.ok(env.calls.every((c) => !isFailure(c)), "not a failure");
  const loud = env.logs.error.map((a) => a.map(String).join(" ")).join("\n");
  assert.match(loud, /future/i);
  assert.match(loud, /2026-09-21T23:59:00Z/, "the raw header is in the log line");
});

test("a refused clock whose failure-record write also throws still throws the refusal", async () => {
  const env = makeEnv({ nowMs: at("2026-09-30T00:00:00Z"), failWhen: () => true });
  await assert.rejects(env.guard(async () => {})({ scheduleTime: SCHEDULED }), /refus/i);
});

test("a retry (same scheduleTime, later now) uses the same date and the same marker path", async () => {
  const first = makeEnv({ nowMs: at("2026-09-21T18:29:05Z") });
  const retry = makeEnv({ nowMs: at("2026-09-21T18:31:00Z") }); // 00:01 IST on 09-22
  let d1, d2;
  await first.guard(async (_e, { today }) => { d1 = today; })({ scheduleTime: SCHEDULED });
  await retry.guard(async (_e, { today }) => { d2 = today; })({ scheduleTime: SCHEDULED });
  assert.equal(d1, "2026-09-21");
  assert.equal(d2, "2026-09-21");
  assert.equal(first.calls[0].path, retry.calls[0].path);
  assert.equal(retry.calls[0].path, markerPath("2026-09-21"));
  assert.equal(retry.calls[0].data.scheduleTime, SCHEDULED);
});

test("no scheduleTime: wall-clock date, marker records clockSource wall-clock", async () => {
  const env = makeEnv({ nowMs: at("2026-09-21T18:29:05Z") });
  let today;
  await env.guard(async (_e, ctx) => { today = ctx.today; })({});
  assert.equal(today, "2026-09-21");
  assert.equal(env.calls[0].data.clockSource, "wall-clock");
  assert.equal(env.calls[0].data.scheduleTime, null);
  assert.equal(env.calls[0].data.driftMs, 0);
});

test("an undefined event does not crash the wrapper", async () => {
  const env = makeEnv();
  await env.guard(async () => {})(undefined);
  assert.equal(env.calls[0].data.clockSource, "wall-clock");
});

// ── completedAt: written by the GUARD, so a Sunday/holiday run (early return, no summary) ends with it too
// A real completion write — NOT the started marker, which also carries `completedAt` but as a delete.
const isCompletedData = (d) => "completedAt" in d && d.completedAt !== DELETE;
const isCompleted = (c) => isCompletedData(c.data);

test("completedAt is written after a successful handler, on the same doc, with merge", async () => {
  const env = makeEnv({ nowMs: at("2026-09-21T18:29:05Z") });
  await env.guard(async () => "done")({ scheduleTime: SCHEDULED });
  const done = env.calls.filter(isCompleted);
  assert.equal(done.length, 1);
  assert.equal(done[0].path, markerPath("2026-09-21"));
  assert.deepEqual(done[0].opts, { merge: true });
  assert.deepEqual(done[0].data, {
    completedAt: { fakeTimestamp: at("2026-09-21T18:29:05Z") },
    failed: DELETE, error: DELETE, failedAt: DELETE,
  }, "completedAt plus FieldValue.delete() for each failure key");
  assert.equal("ok" in done[0].data, false, "success never touches `ok`");
});

test("completedAt is the time the run COMPLETED, not the time it started", async () => {
  const env = makeEnv({ nowMs: at("2026-09-21T18:29:05Z") });
  await env.guard(async () => { env.state.nowMs = at("2026-09-21T18:31:40Z"); })({ scheduleTime: SCHEDULED }); // the run takes 2m35s
  const doc = env.docs.get(markerPath("2026-09-21"));
  assert.deepEqual(doc.startedAt, { fakeTimestamp: at("2026-09-21T18:29:05Z") });
  assert.deepEqual(doc.completedAt, { fakeTimestamp: at("2026-09-21T18:31:40Z") });
  assert.notDeepEqual(doc.completedAt, doc.startedAt);
});

const COMPLETED_DOC = () => ({
  date: "2026-09-21", startedAt: { fakeTimestamp: 1 }, completedAt: { fakeTimestamp: 2 }, ranAt: { fakeTimestamp: 2 }, ok: true,
});

test("re-running an already-completed date whose handler throws ends with NO completedAt (and failed:true)", async () => {
  const p = markerPath("2026-09-21");
  const env = makeEnv({ seed: { [p]: COMPLETED_DOC() } });
  await assert.rejects(env.guard(async () => { throw new Error("re-run died"); })({ scheduleTime: SCHEDULED }));
  const doc = env.docs.get(p);
  assert.equal("completedAt" in doc, false, "the previous run's completedAt must not mask the unfinished re-run");
  assert.equal(doc.failed, true);
  assert.equal(doc.error, "re-run died");
  assert.deepEqual(doc.startedAt, { fakeTimestamp: at("2026-09-21T18:29:05Z") }, "startedAt is the re-run's");
});

test("re-running an already-completed date that dies mid-way (no throw recorded) is startedAt-without-completedAt", async () => {
  const p = markerPath("2026-09-21");
  const env = makeEnv({ seed: { [p]: COMPLETED_DOC() } });
  let seenDuringHandler;
  await env.guard(async () => { seenDuringHandler = { ...env.docs.get(p) }; })({ scheduleTime: SCHEDULED });
  assert.equal("completedAt" in seenDuringHandler, false, "cleared by the started marker, before any scoring");
  assert.ok(seenDuringHandler.startedAt);
});

test("re-running an already-completed date that succeeds ends with a FRESH completedAt", async () => {
  const p = markerPath("2026-09-21");
  const env = makeEnv({ nowMs: at("2026-09-21T18:31:00Z"), seed: { [p]: COMPLETED_DOC() } });
  await env.guard(async () => { env.state.nowMs = at("2026-09-21T18:33:00Z"); })({ scheduleTime: SCHEDULED });
  const doc = env.docs.get(p);
  assert.deepEqual(doc.completedAt, { fakeTimestamp: at("2026-09-21T18:33:00Z") }, "not the old { fakeTimestamp: 2 }");
  assert.deepEqual(doc.startedAt, { fakeTimestamp: at("2026-09-21T18:31:00Z") });
});

test("a failed run then a successful rest-day-shaped retry (no summary write) ends with completedAt and NONE of failed/error/failedAt", async () => {
  const path1 = markerPath("2026-09-21");
  const env = makeEnv({
    seed: { [path1]: { date: "2026-09-21", failed: true, error: "batch exploded", failedAt: { fakeTimestamp: 1 } } },
  });
  await env.guard(async () => { /* Sunday/holiday: early return, writes no summary */ })({ scheduleTime: SCHEDULED });
  const doc = env.docs.get(path1);
  assert.ok(doc.completedAt);
  assert.equal("failed" in doc, false);
  assert.equal("error" in doc, false);
  assert.equal("failedAt" in doc, false);
  assert.ok(doc.startedAt, "the retry's started marker is kept");
});

test("the failure keys are cleared by the write AFTER the handler, never before it", async () => {
  const path1 = markerPath("2026-09-21");
  const env = makeEnv({ seed: { [path1]: { failed: true, error: "old", failedAt: { fakeTimestamp: 1 } } } });
  let duringHandler;
  await env.guard(async () => { duringHandler = { ...env.docs.get(path1) }; })({ scheduleTime: SCHEDULED });
  assert.equal(duringHandler.failed, true, "still failed while the retry is in flight");
  assert.equal(duringHandler.error, "old");
});

test("a failed run writes failed:true / error / failedAt (merge) and a later success clears them", async () => {
  const env = makeEnv();
  await assert.rejects(env.guard(async () => { throw new Error("first attempt"); })({ scheduleTime: SCHEDULED }));
  const p = markerPath("2026-09-21");
  assert.equal(env.docs.get(p).failed, true);
  assert.equal(env.docs.get(p).error, "first attempt");
  env.state.nowMs = at("2026-09-21T18:31:00Z");
  await env.guard(async () => {})({ scheduleTime: SCHEDULED });
  const doc = env.docs.get(p);
  assert.equal(doc.failed, undefined);
  assert.equal(doc.error, undefined);
  assert.equal(doc.failedAt, undefined);
  assert.ok(doc.completedAt);
});

test("completedAt is the LAST write, after everything the handler wrote (it means \"finished\")", async () => {
  const env = makeEnv();
  await env.guard(async (_e, { today }) => {
    await env.db.doc(markerPath(today)).set({ date: today, ranAt: "summary", ok: true }); // the handler's summary
  })({ scheduleTime: SCHEDULED });
  const order = env.calls.map((c) => (isCompleted(c) ? "completed" : "ranAt" in c.data ? "summary" : "startedAt" in c.data ? "marker" : "?"));
  assert.deepEqual(order, ["marker", "summary", "completed"]);
});

test("a handler that returns early (Sunday/holiday, no summary) still ends with completedAt", async () => {
  const env = makeEnv();
  await env.guard(async () => { /* early return, writes nothing */ })({ scheduleTime: SCHEDULED });
  assert.equal(env.calls.filter(isCompleted).length, 1);
});

test("a throwing handler gets NO completedAt, and still gets the failure record", async () => {
  const env = makeEnv();
  const boom = new Error("nope");
  await assert.rejects(env.guard(async () => { throw boom; })({ scheduleTime: SCHEDULED }), (e) => e === boom);
  assert.equal(env.calls.some(isCompleted), false);
  const f = env.calls.find(isFailure);
  assert.equal(f.data.error, "nope");
  assert.ok(f.data.failedAt);
});

test("a completedAt write that throws neither throws nor changes the returned value; it is logged", async () => {
  const env = makeEnv({ failWhen: (_p, data) => isCompletedData(data) });
  const result = { scored: 12 };
  const out = await env.guard(async () => result)({ scheduleTime: SCHEDULED });
  assert.equal(out, result, "same object returned");
  assert.ok(env.logs.error.length >= 1, "the failed completedAt write is logged");
  assert.equal(env.calls.some(isCompleted), false);
});

test("a refused run gets NO completedAt", async () => {
  const env = makeEnv({ nowMs: at("2026-09-30T00:00:00Z") });
  await assert.rejects(env.guard(async () => {})({ scheduleTime: SCHEDULED }), /refus/i);
  assert.equal(env.calls.some(isCompleted), false);
  assert.ok(env.calls.some(isFailure), "the refusal is still recorded as failed:true");
});

// ── invocation log: the only record that survives a retry to verify the scheduleTime assumption ──
// admin/CLAUDE.md: "unconfirmed assumption that Cloud Scheduler resends the original scheduleTime
// on a retry" — the started marker is a merge:true write keyed on the resolved date, so a retry
// overwrites its own scheduleTime over the original's. This log line is written on every single
// invocation regardless of outcome, so the raw scheduleTime survives in Cloud Logging for a human
// to diff across two invocations the next time a real failure actually retries.
test("every invocation logs its raw scheduleTime and resolved date/source/driftMs", async () => {
  const env = makeEnv();
  await env.guard(async () => {})({ scheduleTime: SCHEDULED });
  assert.equal(env.logs.log.length, 1);
  const [line] = env.logs.log[0];
  assert.match(line, /computeDailyAttendanceStatus: invoked with scheduleTime="2026-09-21T18:29:00Z"/);
  assert.match(line, /date=2026-09-21/);
  assert.match(line, /source=schedule/);
  assert.match(line, /driftMs=/);
});

test("a refused invocation still logs its raw scheduleTime, tagged REFUSED with the reason", async () => {
  const env = makeEnv({ nowMs: at("2026-09-30T00:00:00Z") });
  await assert.rejects(env.guard(async () => {})({ scheduleTime: SCHEDULED }));
  const [line] = env.logs.log[0];
  assert.match(line, /scheduleTime="2026-09-21T18:29:00Z"/);
  assert.match(line, /REFUSED/);
});

test("a missing scheduleTime is logged as such, not silently omitted", async () => {
  const env = makeEnv();
  await env.guard(async () => {})({});
  const [line] = env.logs.log[0];
  assert.match(line, /scheduleTime=(undefined|null)/);
});

// ── wiring guard: cheap protection against reverting index.js ───────────────────────────────
test("index.js wraps computeDailyAttendanceStatus in withNightlyGuard and no longer reads Date.now() for `today`", () => {
  const src = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  assert.match(src, /require\("\.\/nightlyGuard"\)/);
  assert.match(src, /withNightlyGuard\(\{/);
  assert.match(src, /FieldValue:\s*admin\.firestore\.FieldValue/, "the guard is given FieldValue so success can clear the failure keys");
  const start = src.indexOf("exports.computeDailyAttendanceStatus = onSchedule(");
  const end = src.indexOf("exports.scoreRetroactiveLeave = ", start);
  assert.ok(start > 0 && end > start, "found the handler region");
  const region = src.slice(start, end);
  assert.match(region, /nightlyGuard\(\s*async \(event, \{ today/, "handler is wrapped and takes { today } from the guard");
  assert.doesNotMatch(region, /Date\.now\s*\(/, "the handler must not compute `today` from the wall clock");
  assert.doesNotMatch(region, /new\s+Date\s*\(/, "no bare `new Date(` in the handler — every date derives from the guard's `today`");
  assert.doesNotMatch(region, /const today\s*=/, "`today` comes from the guard, not a local const");
  assert.doesNotMatch(region, /nowIST/, "no leftover wall-clock derivation");
  // The body now lives in nightlyRunner.js; index.js only injects the admin handles into it.
  assert.match(region, /runNightlyScoring\(\{/, "the handler delegates to the extracted runner");
  assert.match(region, /today, startedAt, clockSource,/, "the guard's date AND marker fields are handed to the runner");
  assert.match(src, /require\("\.\/nightlyRunner"\)/);
});

// Same tripwire, on the file the body moved to: the runner must stay clock-free and keep the
// summary contract the guard's marker depends on (both writes merge onto the same doc).
test("nightlyRunner.js derives every date from the injected `today` and keeps the summary a merge", () => {
  const src = fs.readFileSync(path.join(__dirname, "nightlyRunner.js"), "utf8");
  assert.doesNotMatch(src, /Date\.now\s*\(/, "the runner must not read the wall clock");
  assert.doesNotMatch(src, /new\s+Date\s*\(/, "no bare `new Date(` — every date derives from the guard's `today`");
  assert.doesNotMatch(src, /const today\s*=/, "`today` is a parameter, not a local const");
  assert.doesNotMatch(src, /nowIST/, "no leftover wall-clock derivation");
  assert.doesNotMatch(src, /require\("firebase-(admin|functions)/, "no firebase-admin/-functions require: everything environmental is injected");
  assert.match(src, /startedAt/, "the final summary carries the marker's startedAt");
  assert.match(src, /clockSource/, "the final summary carries the clockSource");
  assert.match(src, /startedAt,\s*clockSource,\s*\}, \{ merge: true \}\);/,
    "the summary is a MERGE so the marker's scheduleTime/driftMs survive on working days");
  assert.match(src, /where\("date", "==", today\)/, "the punch query is keyed on the guard's `today`");
});
