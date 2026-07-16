"use strict";

// Boundary suite for the role-capabilities table. Mirrors roleCapabilities.test.ts
// (admin) and RoleCapabilitiesTest.kt (android) — keep the three in lockstep so a
// role never behaves differently across the two products. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  attendanceInTypes,
  attendanceOutTypes,
  usesFixedWindow,
  usesOtShortageLedger,
  tracksShortage,
  usesConveyance,
  getsCategories,
  inManpowerReports,
  rolesWith,
} = require("./roleCapabilities");

// The design table, encoded once here so a wrong cell fails loudly.
const EXPECTED = {
  office: {
    attendanceInTypes:  ["office_in"],
    attendanceOutTypes: ["office_out"],
    usesFixedWindow: true, usesOtShortageLedger: false, tracksShortage: true,
    usesConveyance: false, getsCategories: false, inManpowerReports: false,
  },
  operations: {
    attendanceInTypes:  ["site_in", "market_in"],
    attendanceOutTypes: ["site_out", "market_out"],
    usesFixedWindow: false, usesOtShortageLedger: true, tracksShortage: true,
    usesConveyance: true, getsCategories: true, inManpowerReports: true,
  },
  sales: {
    attendanceInTypes:  ["office_in", "site_in", "market_in"],
    attendanceOutTypes: ["office_out", "site_out", "market_out"],
    usesFixedWindow: true, usesOtShortageLedger: false, tracksShortage: false,
    usesConveyance: true, getsCategories: false, inManpowerReports: false,
  },
  admin: {
    attendanceInTypes:  ["office_in"],
    attendanceOutTypes: ["office_out"],
    usesFixedWindow: true, usesOtShortageLedger: false, tracksShortage: true,
    usesConveyance: false, getsCategories: false, inManpowerReports: false,
  },
};

for (const [role, exp] of Object.entries(EXPECTED)) {
  test(`${role}: capability table matches the design spec`, () => {
    assert.deepEqual(attendanceInTypes(role),  exp.attendanceInTypes);
    assert.deepEqual(attendanceOutTypes(role), exp.attendanceOutTypes);
    assert.equal(usesFixedWindow(role),      exp.usesFixedWindow);
    assert.equal(usesOtShortageLedger(role), exp.usesOtShortageLedger);
    assert.equal(tracksShortage(role),       exp.tracksShortage);
    assert.equal(usesConveyance(role),       exp.usesConveyance);
    assert.equal(getsCategories(role),       exp.getsCategories);
    assert.equal(inManpowerReports(role),    exp.inManpowerReports);
  });
}

test("sales is a hybrid: office+site+market check-ins, fixed window, conveyance, no OT/manpower", () => {
  // The whole reason the module exists — sales must not collapse into either binary branch.
  assert.deepEqual(attendanceInTypes("sales"),  ["office_in", "site_in", "market_in"]);
  assert.deepEqual(attendanceOutTypes("sales"), ["office_out", "site_out", "market_out"]);
  assert.equal(usesFixedWindow("sales"), true);       // office-style status window
  assert.equal(usesConveyance("sales"), true);        // ops-style conveyance
  assert.equal(usesOtShortageLedger("sales"), false); // NO OT/shortage ledger
  assert.equal(tracksShortage("sales"), false);       // NO shortage/OT concept at all
  assert.equal(inManpowerReports("sales"), false);    // NOT in manpower report
  assert.equal(getsCategories("sales"), false);       // NO labor categories
});

test("tracksShortage is not implied by the ledger — office tracks shortage without one", () => {
  // The reason tracksShortage is its own axis: office/admin show shortage on the portal's
  // Working Hours page but run no ledger, so neither predicate can be derived from the other.
  assert.equal(usesOtShortageLedger("office"), false);
  assert.equal(tracksShortage("office"), true);
  assert.equal(usesOtShortageLedger("admin"), false);
  assert.equal(tracksShortage("admin"), true);
  // Sales is the only role with a fixed window and no shortage — it must not be inferred
  // from any other capability (e.g. "fixed window and conveyance").
  assert.deepEqual(rolesWith("tracksShortage").sort(), ["admin", "office", "operations"]);
});

test("unknown / empty role falls back to office (safe default)", () => {
  for (const role of ["", undefined, null, "mystery"]) {
    assert.deepEqual(attendanceInTypes(role),  ["office_in"]);
    assert.deepEqual(attendanceOutTypes(role), ["office_out"]);
    assert.equal(usesFixedWindow(role), true);
    assert.equal(usesOtShortageLedger(role), false);
    assert.equal(tracksShortage(role), true);
    assert.equal(usesConveyance(role), false);
    assert.equal(getsCategories(role), false);
    assert.equal(inManpowerReports(role), false);
  }
});

test("returned type arrays are copies — mutating one call must not corrupt the table", () => {
  const a = attendanceInTypes("sales");
  a.push("garbage_in");
  assert.deepEqual(attendanceInTypes("sales"), ["office_in", "site_in", "market_in"]);
});

test("rolesWith surfaces the roles a boolean capability is true for", () => {
  assert.deepEqual(rolesWith("usesConveyance").sort(),       ["operations", "sales"]);
  assert.deepEqual(rolesWith("usesOtShortageLedger").sort(), ["operations"]);
  assert.deepEqual(rolesWith("inManpowerReports").sort(),    ["operations"]);
  assert.deepEqual(rolesWith("getsCategories").sort(),       ["operations"]);
  assert.deepEqual(rolesWith("usesFixedWindow").sort(),      ["admin", "office", "sales"]);
});
