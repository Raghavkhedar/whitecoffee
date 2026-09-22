"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { parseArgs, describeUser } = require("./setSuperAdmin");

test("parseArgs: requires --project", () => {
  assert.throws(() => parseArgs([]), /--project/);
});

test("parseArgs: requires --uid", () => {
  assert.throws(() => parseArgs(["--project", "p1"]), /--uid/);
});

test("parseArgs: reads --project and --uid, apply defaults to false", () => {
  const args = parseArgs(["--project", "white-coffee-92c27", "--uid", "u1"]);
  assert.deepStrictEqual(args, { project: "white-coffee-92c27", uid: "u1", apply: false });
});

test("parseArgs: --apply flips apply to true regardless of position", () => {
  const args = parseArgs(["--apply", "--project", "p1", "--uid", "u1"]);
  assert.strictEqual(args.apply, true);
});

test("parseArgs: rejects an unrecognized flag", () => {
  assert.throws(() => parseArgs(["--project", "p1", "--uid", "u1", "--bogus"]), /unrecognized argument/);
});

test("describeUser: refuses a nonexistent user", () => {
  const out = describeUser("ghost", null);
  assert.match(out, /No users\/ghost document exists/);
});

test("describeUser: reports a normal admin as not yet superAdmin", () => {
  const out = describeUser("u1", { name: "Raghav", role: "admin", employeeId: "E1" });
  assert.match(out, /role:\s+admin/);
  assert.match(out, /superAdmin: not set/);
  assert.match(out, /would set superAdmin: true/);
});

test("describeUser: reports a user who already has the flag as a no-op", () => {
  const out = describeUser("u1", { name: "Raghav", role: "admin", employeeId: "E1", superAdmin: true });
  assert.match(out, /already set/);
  assert.match(out, /no change needed/);
});
