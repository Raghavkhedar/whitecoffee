"use strict";

// Unit suite for punch sequencing. Two constraints govern every test here:
//   1. A verdict is never a rejection — assessSequence returns flags, and the punch lands
//      regardless. Nothing below asserts a refusal, because there is no refusal to assert.
//   2. Punches arrive out of order from offline devices. Half of these tests exist only to
//      prove that arrival order is irrelevant and the clock is what decides.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assessSequence, SEQUENCE_FLAGS } = require("./punchSequence");

// 2026-08-08 IST. Cloud functions run on a UTC clock, so IST hh:mm == UTC hh:mm − 05:30.
const ist = (h, m = 0) => Date.UTC(2026, 7, 8, h - 5, m - 30);

let seq = 0;
/** A punch with a Firestore-shaped timestamp and a unique id, like the trigger sees. */
const p = (type, hour, minute = 0, extra = {}) => ({
  id: `p${++seq}`,
  userId: "S338",
  type,
  date: "2026-08-08",
  timestamp: { toMillis: () => ist(hour, minute) },
  ...extra,
});

/** dayPunches as the trigger builds it: a re-read of the day, not the same objects. */
const asStored = (punches) => punches.map((x) => ({ ...x }));

const flagsFor = (punch, day, role) => assessSequence(punch, asStored(day), role).flags;

// ── The happy paths, one per role ──────────────────────────────────────────

test("a clean office day flags nothing", () => {
  const pin = p("office_in", 9, 55);
  const pout = p("office_out", 18, 10);
  const day = [pin, pout];
  assert.deepEqual(flagsFor(pin, day, "office"), []);
  assert.deepEqual(flagsFor(pout, day, "office"), []);
});

test("operations site and market pairs are both clean", () => {
  const sIn = p("site_in", 8, 30);
  const sOut = p("site_out", 13, 0);
  const mIn = p("market_in", 14, 0);
  const mOut = p("market_out", 17, 45);
  const day = [sIn, sOut, mIn, mOut];
  for (const punch of day) {
    assert.deepEqual(flagsFor(punch, day, "operations"), [], punch.type);
  }
});

test("a sales day mixing office, site and market types is clean", () => {
  // Sales is the hybrid role: office_in/out AND site_in/out AND market_in/out all open and
  // close its day. Anything that routes sales down the office branch would call the
  // site_out and market_out below orphans and the day would light up with false flags.
  const oIn = p("office_in", 9, 30);
  const oOut = p("office_out", 11, 0);
  const sIn = p("site_in", 12, 0);
  const sOut = p("site_out", 15, 0);
  const mIn = p("market_in", 15, 30);
  const mOut = p("market_out", 18, 0);
  const day = [oIn, oOut, sIn, sOut, mIn, mOut];
  for (const punch of day) {
    assert.deepEqual(flagsFor(punch, day, "sales"), [], punch.type);
  }
});

test("the same sales day scored as office would NOT be clean (guards the binary)", () => {
  // Proof the per-role table is actually consulted rather than an isOps binary. A sales
  // rep leaves a site at noon and returns to the office at 13:00. Under the sales types
  // the site_out closes the day and the 13:00 office_in reopens it — clean. Under the
  // office types site_out is not an out-type at all, the day never closes, and that same
  // office_in becomes a false double_in. That silent drop into the office branch is the
  // known payroll-bug shape this module must not reproduce.
  const oIn1 = p("office_in", 9, 30);
  const sOut = p("site_out", 12, 0);
  const oIn2 = p("office_in", 13, 0);
  const oOut = p("office_out", 18, 0);
  const day = [oIn1, sOut, oIn2, oOut];
  assert.deepEqual(flagsFor(oIn2, day, "sales"), [], "sales: the site_out closed the day");
  assert.deepEqual(flagsFor(oIn2, day, "office"), [SEQUENCE_FLAGS.DOUBLE_IN],
    "office types cannot close on a site_out — the false flag the binary would produce");
});

// ── The bug this module was written for (employee S338, 2026-08-08) ────────

test("an office_out as the FIRST event of the day is an orphan_out", () => {
  // Real production data: the app held yesterday's in-memory state overnight and
  // authorised a check-OUT with nothing open. Structurally impossible; nothing caught it.
  const orphan = p("office_out", 10, 12);
  assert.deepEqual(flagsFor(orphan, [orphan], "office"), [SEQUENCE_FLAGS.ORPHAN_OUT]);
});

test("an orphan_out is still flagged when a later, unrelated pair follows it", () => {
  const orphan = p("office_out", 10, 12);
  const pin = p("office_in", 11, 0);
  const pout = p("office_out", 18, 0);
  const day = [orphan, pin, pout];
  assert.deepEqual(flagsFor(orphan, day, "office"), [SEQUENCE_FLAGS.ORPHAN_OUT]);
  assert.deepEqual(flagsFor(pout, day, "office"), [], "the honest pair stays clean");
});

test("a second out after the day is closed is also an orphan_out", () => {
  const pin = p("office_in", 9, 0);
  const out1 = p("office_out", 17, 0);
  const out2 = p("office_out", 17, 5);
  const day = [pin, out1, out2];
  assert.deepEqual(flagsFor(out1, day, "office"), []);
  assert.deepEqual(flagsFor(out2, day, "office"), [SEQUENCE_FLAGS.ORPHAN_OUT]);
});

// ── double_in ──────────────────────────────────────────────────────────────

test("a second in over an open day is a double_in", () => {
  const in1 = p("office_in", 9, 0);
  const in2 = p("office_in", 9, 5);
  const day = [in1, in2];
  assert.deepEqual(flagsFor(in1, day, "office"), [], "the first in opened the day honestly");
  assert.deepEqual(flagsFor(in2, day, "office"), [SEQUENCE_FLAGS.DOUBLE_IN]);
});

test("operations: market_in while a site visit is still open is a double_in", () => {
  const sIn = p("site_in", 8, 30);
  const mIn = p("market_in", 11, 0);
  const day = [sIn, mIn];
  assert.deepEqual(flagsFor(mIn, day, "operations"), [SEQUENCE_FLAGS.DOUBLE_IN]);
});

test("re-checking in after a proper checkout is NOT a double_in", () => {
  const in1 = p("site_in", 8, 0);
  const out1 = p("site_out", 12, 0);
  const in2 = p("market_in", 13, 0);
  const day = [in1, out1, in2];
  assert.deepEqual(flagsFor(in2, day, "operations"), []);
});

test("a punch carries at most one flag, and only about itself", () => {
  const in1 = p("office_in", 9, 0);
  const in2 = p("office_in", 9, 1);
  const out = p("office_out", 18, 0);
  const day = [in1, in2, out];
  assert.equal(flagsFor(in2, day, "office").length, 1);
  assert.deepEqual(flagsFor(out, day, "office"), [],
    "the out closes the day the first in opened — the double_in is not contagious");
});

// ── Ordering: the clock decides, not the sync queue ────────────────────────

test("a check-in that syncs AFTER the check-out is still ordered first", () => {
  // The whole reason this module sorts. The 09:00 in-punch was made in a basement and
  // reached Firestore last; walking arrival order would call the 18:00 out an orphan.
  const pin = p("office_in", 9, 0);
  const pout = p("office_out", 18, 0);
  const arrivedOutFirst = [pout, pin];
  assert.deepEqual(flagsFor(pout, arrivedOutFirst, "office"), []);
  assert.deepEqual(flagsFor(pin, arrivedOutFirst, "office"), []);
});

test("a fully shuffled operations day scores identically to a sorted one", () => {
  const sIn = p("site_in", 8, 30);
  const sOut = p("site_out", 13, 0);
  const mIn = p("market_in", 14, 0);
  const mOut = p("market_out", 17, 45);
  const shuffled = [mOut, sOut, mIn, sIn];
  for (const punch of shuffled) {
    assert.deepEqual(flagsFor(punch, shuffled, "operations"), [], punch.type);
  }
});

test("the late arrival of an in-punch clears what looked like an orphan", () => {
  // Documented and accepted: the verdict stored on the out-punch when it was written is
  // now stale. Re-assessing the same punch against the completed day returns no flag.
  const pout = p("office_out", 18, 0);
  assert.deepEqual(flagsFor(pout, [pout], "office"), [SEQUENCE_FLAGS.ORPHAN_OUT],
    "alone, the out-punch genuinely looks orphaned");
  const pin = p("office_in", 9, 0);
  assert.deepEqual(flagsFor(pout, [pout, pin], "office"), [],
    "once the basement check-in syncs, the day reads clean");
});

test("timestamps in every Firestore shape are ordered together", () => {
  // toMillis is reused from punchIntegrity, so epoch millis, Date and _seconds all sort
  // against each other rather than being three incomparable islands.
  const pin = { id: "a", type: "office_in", timestamp: ist(9, 0) };
  const mid = { id: "b", type: "office_out", timestamp: new Date(ist(13, 0)) };
  const late = { id: "c", type: "office_in", timestamp: { _seconds: ist(14, 0) / 1000 } };
  const day = [late, pin, mid];
  assert.deepEqual(assessSequence(mid, day, "office").flags, []);
  assert.deepEqual(assessSequence(late, day, "office").flags, [],
    "14:00 in-punch follows the 13:00 out — the day was closed");
});

// ── Commute markers are not attendance ─────────────────────────────────────

test("home_in and home_out are ignored entirely", () => {
  const hOut = p("home_out", 8, 0);
  const pin = p("office_in", 9, 30);
  const pout = p("office_out", 18, 0);
  const hIn = p("home_in", 19, 0);
  const day = [hOut, pin, pout, hIn];
  assert.deepEqual(flagsFor(hOut, day, "office"), [],
    "a home_out before any check-in is a commute, not an orphan checkout");
  assert.deepEqual(flagsFor(hIn, day, "operations"), []);
  assert.deepEqual(flagsFor(pin, day, "office"), [], "commute markers do not open the day");
  assert.deepEqual(flagsFor(pout, day, "office"), []);
});

test("a day of nothing but commute markers flags nothing", () => {
  const hOut = p("home_out", 8, 0);
  const hIn = p("home_in", 20, 0);
  assert.deepEqual(flagsFor(hOut, [hOut, hIn], "operations"), []);
});

// ── Roles ──────────────────────────────────────────────────────────────────

test("an unknown or missing role falls back to office", () => {
  const orphan = p("office_out", 10, 12);
  for (const role of ["manager", "", null, undefined]) {
    assert.deepEqual(flagsFor(orphan, [orphan], role), [SEQUENCE_FLAGS.ORPHAN_OUT],
      `role=${String(role)}`);
  }
  // …and under that fallback the ops-only types are simply not sequenced.
  const sOut = p("site_out", 10, 12);
  assert.deepEqual(flagsFor(sOut, [sOut], "manager"), []);
});

test("admin is scored on the office types", () => {
  const orphan = p("office_out", 10, 12);
  assert.deepEqual(flagsFor(orphan, [orphan], "admin"), [SEQUENCE_FLAGS.ORPHAN_OUT]);
});

// ── Degenerate input must never throw — a crash would lose the annotation ──

test("a null timestamp yields no verdict rather than a guess", () => {
  const noTs = { id: "x", type: "office_out", timestamp: null };
  assert.deepEqual(assessSequence(noTs, [noTs], "office").flags, [],
    "unplaceable on the clock, so it is not accused of anything");
});

test("a neighbour with an unusable timestamp is skipped, not guessed at", () => {
  const broken = { id: "x", type: "office_in", timestamp: undefined };
  const pout = p("office_out", 18, 0);
  assert.deepEqual(assessSequence(pout, [broken, pout], "office").flags,
    [SEQUENCE_FLAGS.ORPHAN_OUT],
    "an in-punch we cannot place cannot be credited with opening the day");
});

test("an empty, absent or junk-filled dayPunches never throws", () => {
  const pout = p("office_out", 18, 0);
  // The punch is missing from its own day (a stale read) — still assessed, in place.
  assert.deepEqual(assessSequence(pout, [], "office").flags, [SEQUENCE_FLAGS.ORPHAN_OUT]);
  assert.deepEqual(assessSequence(pout, null, "office").flags, [SEQUENCE_FLAGS.ORPHAN_OUT]);
  assert.deepEqual(assessSequence(pout, undefined, "office").flags,
    [SEQUENCE_FLAGS.ORPHAN_OUT]);
  assert.deepEqual(assessSequence(pout, [null, 7, "x", {}], "office").flags,
    [SEQUENCE_FLAGS.ORPHAN_OUT]);
});

test("a punch absent from dayPunches is placed on the clock, not appended", () => {
  const pin = p("office_in", 9, 0);
  const pout = p("office_out", 18, 0);
  // pout is the new punch; the day read back does not contain it yet.
  assert.deepEqual(assessSequence(pout, [pin], "office").flags, []);
  // pin is the new punch and the day read back only has the later out-punch.
  assert.deepEqual(assessSequence(pin, [pout], "office").flags, []);
});

test("a missing type, a missing punch, or a junk punch never throws", () => {
  assert.deepEqual(assessSequence({ timestamp: ist(9, 0) }, [], "office").flags, []);
  assert.deepEqual(assessSequence({ type: 42, timestamp: ist(9, 0) }, [], "office").flags, []);
  assert.deepEqual(assessSequence(null, [], "office").flags, []);
  assert.deepEqual(assessSequence(undefined, undefined, undefined).flags, []);
  assert.deepEqual(assessSequence("nonsense", [], "office").flags, []);
});

test("an exact duplicate punch is reported on the later of the pair", () => {
  // Same type, same instant, different documents: the one just written is the duplicate.
  const in1 = { id: "a", type: "office_in", timestamp: ist(9, 0) };
  const in2 = { id: "b", type: "office_in", timestamp: ist(9, 0) };
  assert.deepEqual(assessSequence(in2, [in1, in2], "office").flags,
    [SEQUENCE_FLAGS.DOUBLE_IN]);
  // Matching is by id, so the FIRST of the pair keeps its clean verdict.
  assert.deepEqual(assessSequence(in1, [in1, in2], "office").flags, []);
});

// ── Contract ───────────────────────────────────────────────────────────────

test("SEQUENCE_FLAGS is frozen and names exactly the two verdicts", () => {
  assert.deepEqual(Object.keys(SEQUENCE_FLAGS).sort(), ["DOUBLE_IN", "ORPHAN_OUT"]);
  assert.equal(SEQUENCE_FLAGS.ORPHAN_OUT, "orphan_out");
  assert.equal(SEQUENCE_FLAGS.DOUBLE_IN, "double_in");
  assert.ok(Object.isFrozen(SEQUENCE_FLAGS));
});

test("assessSequence does not mutate or reorder the caller's array", () => {
  const pin = p("office_in", 9, 0);
  const pout = p("office_out", 18, 0);
  const day = [pout, pin];
  assessSequence(pout, day, "office");
  assert.deepEqual(day, [pout, pin], "the caller's arrival-ordered list is untouched");
});

// ── isDayOpen — the forgot-to-check-out signature the evening reminder pushes on ────────
// The stakes are asymmetric and that shapes every case below: a missed reminder costs an
// employee half a day's pay, but a reminder sent to someone who DID check out teaches the
// whole company to ignore the notification, which costs everyone the feature.

const { isDayOpen } = require("./punchSequence");

test("isDayOpen: checked in and never out — the day the reminder exists for", () => {
  assert.equal(isDayOpen(asStored([p("home_in", 9, 30), p("office_in", 9, 55)]), "office"), true);
});

test("isDayOpen: a properly closed day is not open", () => {
  assert.equal(
    isDayOpen(asStored([p("office_in", 9, 55), p("office_out", 18, 5)]), "office"),
    false
  );
});

test("isDayOpen: no punches at all is NOT open — never nag someone who never came in", () => {
  assert.equal(isDayOpen([], "office"), false);
});

test("isDayOpen: home_in alone is not an open day — commute markers never open one", () => {
  assert.equal(isDayOpen(asStored([p("home_in", 9, 30)]), "office"), false);
});

test("isDayOpen: decided by the clock, not by arrival order", () => {
  // The out-punch synced first; the day is still closed because it happened last.
  const pin = p("office_in", 9, 55);
  const pout = p("office_out", 18, 5);
  assert.equal(isDayOpen(asStored([pout, pin]), "office"), false);
});

test("isDayOpen: re-opened after checking out — multi-cycle office day left open", () => {
  assert.equal(
    isDayOpen(asStored([
      p("office_in", 9, 55), p("office_out", 13, 0), p("office_in", 14, 0),
    ]), "office"),
    true
  );
});

test("isDayOpen: operations site day left open", () => {
  assert.equal(isDayOpen(asStored([p("site_in", 9, 0)]), "operations"), true);
  assert.equal(
    isDayOpen(asStored([p("site_in", 9, 0), p("site_out", 17, 0)]), "operations"),
    false
  );
});

test("isDayOpen: sales closing a site visit with a market punch still closes the day", () => {
  assert.equal(
    isDayOpen(asStored([p("site_in", 10, 0), p("market_out", 16, 0)]), "sales"),
    false
  );
});

test("isDayOpen: an office_in is invisible to operations — role decides the types", () => {
  // Never re-derive types from an isOperations binary: office_in is not an ops check-in.
  assert.equal(isDayOpen(asStored([p("office_in", 9, 55)]), "operations"), false);
});

test("isDayOpen: unusable timestamp is dropped, not guessed at", () => {
  const broken = { id: "x", type: "office_out", timestamp: null };
  assert.equal(isDayOpen(asStored([p("office_in", 9, 55), broken]), "office"), true);
});

test("isDayOpen: tolerates junk without throwing", () => {
  assert.equal(isDayOpen(null, "office"), false);
  assert.equal(isDayOpen([null, undefined, 42, "x"], "office"), false);
});
