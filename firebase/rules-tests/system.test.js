"use strict";

/**
 * SYSTEM RUN RECORDS — system/**
 *
 * Written ONLY by Cloud Functions (Admin SDK, bypasses rules). Two kinds live here and
 * both are security-relevant, not merely operational:
 *
 *   system/accruals/monthly/{YYYY-MM}
 *     The PL-accrual idempotency marker. accrueMonthlyLeave claims it with
 *     batch.create(), which throws ALREADY_EXISTS and aborts the whole atomic batch on a
 *     re-run. Its EXISTENCE is the only thing standing between a scheduler retry and
 *     every employee silently receiving a second paid leave day. A client that could
 *     DELETE this doc could re-open that hole on demand.
 *
 *   system/nightly_runs/computeDailyAttendanceStatus/{date}
 *     Per-run summary: expected vs scored, plus per-user failures. `ok: false` is the
 *     signal that a night was partial and somebody's pay may be short. A client that
 *     could FORGE one could mask a shortfall; the failure entries also carry employee
 *     IDs, so the read grant is admin-only like every other pay-adjacent collection.
 *
 * Note both paths are nested (4 and 5 segments), so this also asserts the recursive
 * {docId=**} wildcard actually covers the depths the functions write at — a rule matching
 * only `system/{docId}` would leave both real paths unmatched.
 */

const { test, before, after } = require("node:test");
const {
  setup, teardown, seedUsers, seedDocs, asUser,
  assertSucceeds, assertFails,
} = require("./helpers");

let env;

const RUN_DOC     = "system/nightly_runs/computeDailyAttendanceStatus/2026-08-06";
const ACCRUAL_DOC = "system/accruals/monthly/2026-08";

before(async () => {
  env = await setup();
  await seedUsers(env, {
    admin:  { role: "admin" },
    office: { role: "office" },
    ops:    { role: "operations" },
  });
  await seedDocs(env, {
    [RUN_DOC]: {
      date: "2026-08-06", activeUsers: 22, adminMarked: 1,
      expected: 21, scored: 21, plDeducted: 2, plAttempted: 2,
      failures: [], plFailures: [], ok: true,
    },
    [ACCRUAL_DOC]: { month: "2026-08", appliedTo: 22 },
  });
});

after(async () => { await teardown(); });

test("system run summary: admin reads, employees cannot", async () => {
  await assertSucceeds(asUser(env, "admin").doc(RUN_DOC).get());
  // Failure entries carry employee IDs — same narrowness as dailySpend/compensation.
  await assertFails(asUser(env, "office").doc(RUN_DOC).get());
  await assertFails(asUser(env, "ops").doc(RUN_DOC).get());
});

test("system run summary: nobody can forge or edit one, not even admin", async () => {
  // Only the Cloud Function (Admin SDK) writes these. A forged `ok: true` would hide a
  // partial night; a forged `ok: false` would raise a false payroll alarm.
  await assertFails(asUser(env, "admin").doc(RUN_DOC).set({ ok: true }, { merge: true }));
  await assertFails(asUser(env, "office").doc(RUN_DOC).set({ ok: true }, { merge: true }));
  await assertFails(
    asUser(env, "admin")
      .doc("system/nightly_runs/computeDailyAttendanceStatus/2026-08-07")
      .set({ ok: true, scored: 21, expected: 21 })
  );
});

test("PL accrual marker: cannot be deleted or overwritten by any client", async () => {
  // Deleting this doc would let the next accrueMonthlyLeave run credit +1 PL to every
  // employee a second time for the same month. This is the double-pay guard.
  await assertFails(asUser(env, "admin").doc(ACCRUAL_DOC).delete());
  await assertFails(asUser(env, "office").doc(ACCRUAL_DOC).delete());
  await assertFails(asUser(env, "admin").doc(ACCRUAL_DOC).set({ month: "2026-08" }));

  // Admin may still READ it (to confirm an accrual ran); employees may not.
  await assertSucceeds(asUser(env, "admin").doc(ACCRUAL_DOC).get());
  await assertFails(asUser(env, "office").doc(ACCRUAL_DOC).get());
});

test("system/**: unseeded paths at every depth stay closed to employees", async () => {
  // Even segment counts only — an odd path is a COLLECTION, and db.doc() would reject it
  // client-side before the rules ever ran, making the assertion pass for the wrong reason.
  const shallow = "system/somedoc";                       // 2 segments
  const deep    = "system/some/future/record";            // 4 segments

  await assertFails(asUser(env, "office").doc(shallow).get());
  await assertFails(asUser(env, "office").doc(shallow).set({ x: 1 }));
  await assertFails(asUser(env, "office").doc(deep).get());
  await assertFails(asUser(env, "office").doc(deep).set({ x: 1 }));
  // Admin write stays closed at every depth too — these are Admin-SDK-only collections.
  await assertFails(asUser(env, "admin").doc(deep).set({ x: 1 }));
});
