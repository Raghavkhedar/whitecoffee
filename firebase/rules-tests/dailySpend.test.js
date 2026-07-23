"use strict";

/**
 * DAILY SPEND SNAPSHOT — dailySpend/{uid}__{date}
 *
 * Authored ONLY by the snapshotDailySpend Cloud Function (Admin SDK, bypasses rules).
 * No client write path exists — not even for an admin. Reads are admin-only: each doc
 * carries the same per-day pay figures (salary, conveyance, pf, esi, otWo, totalSpend)
 * that compensation/current is isolated for, so the read grant must be just as narrow.
 */

const { test, before, after } = require("node:test");
const {
  setup, teardown, seedUsers, seedDocs, asUser,
  assertSucceeds, assertFails,
} = require("./helpers");

let env;

before(async () => {
  env = await setup();
  await seedUsers(env, {
    admin:  { role: "admin" },
    office: { role: "office" },
  });
  await seedDocs(env, {
    "dailySpend/u1__2026-07-24": {
      userId: "u1", employeeId: "U1", name: "Test User", role: "operations",
      date: "2026-07-24", month: "2026-07",
      salary: 1000, conveyance: 0, pf: 120, esi: 0, otWo: 0, imprest: 50,
      totalSpend: 830, frozen: false, computedAt: new Date().toISOString(),
    },
  });
});

after(async () => { await teardown(); });

test("dailySpend: admin can read, non-admin cannot, nobody can write", async () => {
  const ref = "dailySpend/u1__2026-07-24";

  await assertSucceeds(asUser(env, "admin").doc(ref).get());
  await assertFails(asUser(env, "office").doc(ref).get());
  // Even admin cannot write via the client SDK — only the Cloud Function (Admin SDK) writes.
  await assertFails(asUser(env, "admin").doc(ref).set({ salary: 1 }, { merge: true }));
});
