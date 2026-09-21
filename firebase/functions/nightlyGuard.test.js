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

test("marker is written FIRST, before the handler, with startedAt/clockSource/scheduleTime and merge", async () => {
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

test("a refused clock writes a failure record, throws, and never runs the handler", async () => {
  const env = makeEnv({ nowMs: at("2026-09-30T00:00:00Z") });
  let ran = false;
  await assert.rejects(env.guard(async () => { ran = true; })({ scheduleTime: SCHEDULED }), /refus/i);
  assert.equal(ran, false);
  const failure = env.calls.find(isFailure);
  assert.ok(failure, "a failure record is written");
  assert.equal("ok" in failure.data, false);
  assert.deepEqual(failure.opts, { merge: true });
  assert.match(failure.data.error, /past/i);
  assert.ok(failure.data.failedAt);
  assert.ok(env.logs.error.length >= 1);
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
});

test("an undefined event does not crash the wrapper", async () => {
  const env = makeEnv();
  await env.guard(async () => {})(undefined);
  assert.equal(env.calls[0].data.clockSource, "wall-clock");
});

// ── completedAt: written by the GUARD, so a Sunday/holiday run (early return, no summary) ends with it too
const isCompleted = (c) => "completedAt" in c.data;

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

test("completedAt is written AFTER the handler's own summary write (that write is a full set and would wipe it)", async () => {
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
  const env = makeEnv({ failWhen: (_p, data) => "completedAt" in data });
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
  assert.doesNotMatch(region, /Date\.now\(\)/, "the handler must not compute `today` from the wall clock");
  assert.doesNotMatch(region, /const today\s*=/, "`today` comes from the guard, not a local const");
  assert.doesNotMatch(region, /nowIST/, "no leftover wall-clock derivation");
  assert.match(region, /startedAt/, "the final summary carries the marker's startedAt");
  assert.match(region, /clockSource/, "the final summary carries the clockSource");
});
