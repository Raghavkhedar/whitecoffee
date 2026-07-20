"use strict";

/**
 * Shared harness for the firestore.rules security suite.
 *
 * These tests are the ONLY automated check on the security boundary. The app uses the
 * client Firebase SDK, so firestore.rules is not one layer of defence among several —
 * it IS the defence. Anything the rules permit, an employee can do directly against the
 * API with their own legitimate credentials, bypassing every check in the admin portal
 * and the Android app.
 *
 * Run: `npm test` in this directory (boots the Firestore emulator via firebase.json).
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");

const RULES_PATH = path.join(__dirname, "..", "firestore.rules");

/** Every tab that can be granted to a non-admin manager (see admin/src/lib/portalAccess.ts). */
const TABS = {
  ATTENDANCE: "/attendance",
  LEAVES: "/leaves",
  REGULARIZATION: "/regularization",
  OT_SHORTAGE: "/ot-shortage",
  OT_SETTLEMENTS: "/ot-settlements",
  HOURS: "/working-hours-shortage-excess",
  MANPOWER: "/manpower-utilisation-input",
  SUBMISSIONS: "/submissions",
  CONVEYANCE: "/conveyance",
  NOTIFICATIONS: "/notifications",
};

let testEnv;

async function setup() {
  testEnv = await initializeTestEnvironment({
    projectId: "whitecoffee-rules-test",
    firestore: {
      rules: fs.readFileSync(RULES_PATH, "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
  return testEnv;
}

async function teardown() {
  if (testEnv) await testEnv.cleanup();
}

/**
 * Seed the user profiles the rules read via get() — userRole() and userTabs() both
 * resolve against users/{uid}, so nearly every rule depends on this fixture existing.
 * Written with rules DISABLED, exactly as the Admin SDK / Cloud Functions would.
 */
async function seedUsers(env, users) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, data] of Object.entries(users)) {
      await db.doc(`users/${uid}`).set({
        name: data.name || uid,
        employeeId: data.employeeId || uid.toUpperCase(),
        role: data.role || "operations",
        active: data.active !== false,
        salaryRate: data.salaryRate ?? 1000,
        ...(data.tabAccess ? { tabAccess: data.tabAccess } : {}),
      });
    }
  });
}

/** Seed arbitrary documents with rules disabled (server-side writes). */
async function seedDocs(env, docs) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [docPath, data] of Object.entries(docs)) {
      await db.doc(docPath).set(data);
    }
  });
}

const asUser = (env, uid) => env.authenticatedContext(uid).firestore();
const asAnon = (env) => env.unauthenticatedContext().firestore();

module.exports = {
  TABS,
  setup,
  teardown,
  seedUsers,
  seedDocs,
  asUser,
  asAnon,
  assertSucceeds,
  assertFails,
};
