"use strict";

// Unit suite for the Site Manpower Time Utilisation visit builder. Pure logic,
// no Firestore. Run: `npm test` (node --test, no extra deps).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildManpowerVisits, round4 } = require("./manpowerVisits");

// Helpers: build site_in / site_out events at an IST minute-of-day.
const IN  = (min, o = {}) => ({ type: "site_in",  min, ...o });
const OUT = (min, o = {}) => ({ type: "site_out", min, ...o });

test("clean single visit → one row, correct fraction, is OT target", () => {
  // 11:00–12:00 = 60 min = 60/480 = 0.125
  const v = buildManpowerVisits([
    IN(660, { siteName: "Burari", siteId: "CCO1", visitType: "inspection", workDone: ["Elec"] }),
    OUT(720),
  ]);
  assert.equal(v.length, 1);
  assert.equal(v[0].siteName, "Burari");
  assert.equal(v[0].siteId, "CCO1");
  assert.equal(v[0].visitType, "inspection");
  assert.deepEqual(v[0].workDone, ["Elec"]);
  assert.equal(v[0].timeFraction, 0.125);
  assert.equal(v[0].otTarget, true);
});

test("same site visited twice in a day → two separate rows", () => {
  const v = buildManpowerVisits([
    IN(600, { siteName: "SiteA" }), OUT(660),   // 10:00–11:00
    IN(720, { siteName: "SiteA" }), OUT(780),   // 12:00–13:00
  ]);
  assert.equal(v.length, 2);
  assert.equal(v[0].siteName, "SiteA");
  assert.equal(v[1].siteName, "SiteA");
  assert.equal(v[0].timeFraction, 0.125);
  assert.equal(v[1].timeFraction, 0.125);
});

test("two different sites → two rows with per-site fractions", () => {
  const v = buildManpowerVisits([
    IN(600, { siteName: "A" }), OUT(690),   // 90 min → 0.1875
    IN(700, { siteName: "B" }), OUT(720),   // 20 min → 0.0417 (rounded)
  ]);
  assert.equal(v.length, 2);
  assert.equal(v[0].timeFraction, 0.1875);
  assert.equal(v[1].timeFraction, 0.0417);
});

test("missed logout (in, no out) → row with null time, still OT target", () => {
  const v = buildManpowerVisits([IN(600, { siteName: "A" })]);
  assert.equal(v.length, 1);
  assert.equal(v[0].timeFraction, null);
  assert.equal(v[0].otTarget, true);
});

test("orphan logout (out, no in) → skipped", () => {
  const v = buildManpowerVisits([OUT(600, { siteName: "A" })]);
  assert.equal(v.length, 0);
});

test("over-8h visit → fraction exceeds 1 (no cap)", () => {
  // 09:00–18:00 = 540 min = 540/480 = 1.125
  const v = buildManpowerVisits([IN(540), OUT(1080)]);
  assert.equal(v[0].timeFraction, 1.125);
});

test("OT target is the visit with the latest departure", () => {
  const v = buildManpowerVisits([
    IN(660, { siteName: "First" }), OUT(720),    // 11:00–12:00
    IN(1020, { siteName: "Last" }), OUT(1110),   // 17:00–18:30 (latest out)
  ]);
  assert.equal(v[0].otTarget, false);
  assert.equal(v[1].otTarget, true);
  assert.equal(v[1].siteName, "Last");
});

test("classification falls back from site_in to site_out when the in is empty", () => {
  const v = buildManpowerVisits([
    IN(600,  { siteName: "", siteId: "", visitType: "", workDone: [] }),
    OUT(660, { siteName: "A", siteId: "CC9", visitType: "complaint", workDone: ["Mech"] }),
  ]);
  assert.equal(v[0].siteName, "A");
  assert.equal(v[0].siteId, "CC9");
  assert.equal(v[0].visitType, "complaint");
  assert.deepEqual(v[0].workDone, ["Mech"]);
});

test("round4 rounds to four decimals", () => {
  assert.equal(round4(20 / 480), 0.0417);
  assert.equal(round4(0.0625), 0.0625);
});
