"use strict";

/**
 * The two collections behind self-service password reset must be invisible to clients.
 *
 * Both are written ONLY by the Admin SDK inside `requestPasswordReset`, which bypasses
 * rules entirely — so neither needs (or has) a `match` block in firestore.rules. This
 * suite exists to prove that absence is genuinely closed rather than merely untested:
 *
 *   passwordResetThrottle/{hash} — the rate-limit ledger. Client WRITE access would let
 *     anyone clear their own throttle and brute-force the endpoint; client READ access
 *     would turn it into an existence oracle, since a doc only exists for an identifier
 *     someone has actually tried.
 *
 *   passwordResetRequests/{autoId} — the admin-visible trail. Every row carries an
 *     identifier and an outcome like "no-such-account", which is exactly the enumeration
 *     signal the endpoint's constant reply is designed to withhold. Readable by a
 *     signed-in employee, it would hand back everything the endpoint refuses to say.
 *
 * If someone later adds a `match` for either path, these fail — which is the point.
 */

const { test, before, after, beforeEach } = require("node:test");
const {
  setup, teardown, seedUsers, seedDocs, asUser,
  assertSucceeds, assertFails,
} = require("./helpers");

let env;

before(async () => { env = await setup(); });
after(async () => { await teardown(env); });

beforeEach(async () => {
  await seedUsers(env, {
    admin: { role: "admin" },
    emp:   { role: "operations" },
  });
  await seedDocs(env, {
    "passwordResetThrottle/abc123": { attempts: [1, 2, 3], updatedAt: 1 },
    "passwordResetRequests/req1":   { identifier: "s450", outcome: "no-such-account" },
  });
});

test("an employee cannot read the throttle ledger", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("passwordResetThrottle/abc123").get());
});

test("an employee cannot clear their own throttle", async () => {
  // The whole rate limit rests on this. A client that can delete or overwrite its own
  // throttle doc has no rate limit at all.
  const db = asUser(env, "emp");
  await assertFails(db.doc("passwordResetThrottle/abc123").set({ attempts: [] }));
  await assertFails(db.doc("passwordResetThrottle/abc123").update({ attempts: [] }));
  await assertFails(db.doc("passwordResetThrottle/abc123").delete());
});

test("not even an admin gets a client-side door to the throttle ledger", async () => {
  // Nothing in either app reads this; the Admin SDK is the only writer. An admin grant
  // here would be pure attack surface for no feature.
  const db = asUser(env, "admin");
  await assertFails(db.doc("passwordResetThrottle/abc123").get());
  await assertFails(db.doc("passwordResetThrottle/abc123").set({ attempts: [] }));
});

test("an employee cannot read the reset-request trail", async () => {
  // This is the enumeration leak: outcome "no-such-account" vs "sent" is precisely what
  // SELF_SERVICE_MESSAGE refuses to disclose.
  const db = asUser(env, "emp");
  await assertFails(db.doc("passwordResetRequests/req1").get());
});

test("an employee cannot forge or tamper with the reset-request trail", async () => {
  const db = asUser(env, "emp");
  await assertFails(db.doc("passwordResetRequests/forged").set({ identifier: "s001", outcome: "sent" }));
  await assertFails(db.doc("passwordResetRequests/req1").update({ outcome: "sent" }));
  await assertFails(db.doc("passwordResetRequests/req1").delete());
});

test("an unauthenticated caller reaches neither collection", async () => {
  // The endpoint itself is unauthenticated, so this is the caller that matters most:
  // whatever it can reach directly, it reaches without any credential at all.
  const db = env.unauthenticatedContext().firestore();
  await assertFails(db.doc("passwordResetThrottle/abc123").get());
  await assertFails(db.doc("passwordResetRequests/req1").get());
  await assertFails(db.doc("passwordResetThrottle/abc123").set({ attempts: [] }));
});

test("the seeded control still works — the harness itself is not just failing everything", async () => {
  // Without this, every assertion above would pass even if the emulator were misconfigured
  // and denying literally all access.
  await assertSucceeds(asUser(env, "admin").doc("users/emp").get());
});
