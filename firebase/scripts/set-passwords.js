#!/usr/bin/env node
"use strict";

/**
 * BREAK-GLASS password reset, by login email.
 *
 *   node set-passwords.js s450@whitecoffee.internal [more@addresses ...]
 *
 * This is NOT the normal path. Day to day, reset passwords from the admin portal
 * (/users → edit an employee → "Send a reset link"), which lets the employee choose
 * their own password and never puts it through a human's hands. Use this script only
 * when the portal cannot help — in practice, when the ADMIN is the one locked out and
 * so has nobody to click the button for them.
 *
 * Auth: Application Default Credentials. Either
 *   gcloud auth application-default login
 * or point GOOGLE_APPLICATION_CREDENTIALS at a service-account key.
 * ADC is separate from the Firebase CLI login, and usually also wants
 *   export GOOGLE_CLOUD_QUOTA_PROJECT=white-coffee-92c27
 *
 * ⚠️ Passwords are read from the terminal with echo OFF, never from argv.
 * The previous version took "email=password" arguments, which wrote every password
 * a human had ever set into ~/.bash_history in plaintext, where it stayed forever.
 * Only the account addresses — which are not secrets — go on the command line.
 *
 * Each account is resolved and shown to you BEFORE anything is written, so you can
 * confirm you are about to change the right person's password rather than discovering
 * it afterwards.
 */

const readline = require("node:readline");

// Same resolution dance as backup-users.js — there is no package.json in scripts/,
// so fall back to the copy the functions install already pulled down.
const admin = (() => {
  try { return require("firebase-admin"); }
  catch { return require(require("node:path").join(__dirname, "..", "functions", "node_modules", "firebase-admin")); }
})();

const MIN_PASSWORD_LENGTH = 6; // Firebase's own floor; mirrors MIN_PASSWORD_LENGTH in admin/src/lib/passwordReset.ts

const emails = process.argv.slice(2).map((a) => a.trim().toLowerCase()).filter(Boolean);

if (emails.length === 0) {
  console.error("Usage: node set-passwords.js <login-email> [<login-email> ...]");
  console.error("Passwords are prompted for; do NOT put them on the command line.");
  process.exit(1);
}

// An "email=password" argument is the old, leaky calling convention. Refuse it loudly
// rather than silently treating the whole string as an address — by the time the script
// runs the secret is already in shell history, and the operator needs to know that.
for (const email of emails) {
  if (email.includes("=")) {
    console.error(`Refusing to run: "${email}" looks like the old email=password form.`);
    console.error("That leaks the password into your shell history. Pass only the address;");
    console.error("you will be prompted for the password. Consider scrubbing your history.");
    process.exit(1);
  }
}

/** Reads one line from the terminal. With `hidden`, nothing is echoed as you type. */
function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Suppress the echo of typed characters, but still emit the newline on Enter so
      // the cursor moves on. readline offers no public API for this.
      rl._writeToOutput = (chunk) => { if (chunk.includes("\n")) rl.output.write("\n"); };
    }
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

if (!process.stdin.isTTY) {
  console.error("Refusing to run without a terminal: passwords must be typed interactively,");
  console.error("not piped in (a pipe usually means the secret came from a file or history).");
  process.exit(1);
}

admin.initializeApp({ projectId: "white-coffee-92c27" });

(async () => {
  let failed = 0;

  for (const email of emails) {
    console.log("");

    // Resolve FIRST. Knowing which account you are about to touch is the whole point
    // of the confirmation step; the old script only printed the uid after writing.
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
    } catch (e) {
      failed++;
      console.error(`FAIL ${email} — ${e.code || ""} ${e.message}`);
      continue;
    }

    console.log(`  account : ${user.email}`);
    console.log(`  uid     : ${user.uid}`);
    console.log(`  name    : ${user.displayName || "(none set in Auth)"}`);
    if (user.disabled) {
      console.log("  ⚠️ THIS ACCOUNT IS DISABLED — a new password will not let them in.");
    }

    const go = await ask("  Change this account's password? [y/N] ");
    if (go.trim().toLowerCase() !== "y") {
      console.log(`  skipped ${email}`);
      continue;
    }

    const password = await ask(`  New password (min ${MIN_PASSWORD_LENGTH} chars, not echoed): `, { hidden: true });
    if (password.length < MIN_PASSWORD_LENGTH) {
      failed++;
      console.error(`  FAIL ${email} — password is under ${MIN_PASSWORD_LENGTH} characters; Firebase would reject it.`);
      continue;
    }

    // Typed blind, so a typo is invisible and would lock the person out exactly as
    // before. Confirm against a second entry rather than trusting one pass.
    const again = await ask("  Type it again to confirm: ", { hidden: true });
    if (again !== password) {
      failed++;
      console.error(`  FAIL ${email} — the two entries did not match; nothing was changed.`);
      continue;
    }

    try {
      await admin.auth().updateUser(user.uid, { password });
      console.log(`  ok   ${email} → uid ${user.uid}`);
    } catch (e) {
      failed++;
      console.error(`  FAIL ${email} — ${e.code || ""} ${e.message}`);
    }
  }

  console.log("");
  process.exit(failed ? 1 : 0);
})();
