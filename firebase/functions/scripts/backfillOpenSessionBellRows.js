#!/usr/bin/env node
"use strict";

/**
 * ONE-OFF backfill: give every past open-session reminder its in-app bell row.
 *
 *   sent_notifications/open-session-{uid}-{date}  →  users/{uid}/notifications/open-session-{date}
 *
 * Until 2026-09-30 openSessionReminder wrote only the push doc and relied on Android's
 * FcmService to save the bell row — a write firestore.rules has denied to normal employees
 * since 2026-07-20. So these reminders were pushed but never listed. The function now writes
 * the row itself (see openSessionReminder.js); this fills the history.
 *
 * SAFETY MODEL:
 *   - Default is a DRY RUN. Nothing is written unless --apply is passed.
 *   - --project <id> is REQUIRED and is what firebase-admin is initialised with.
 *   - Rows are written with create(), never set(): an existing row (including one the function
 *     wrote tonight) is never overwritten. A re-run is a no-op.
 *   - A day where the user ALREADY has a reminder row (the old client write succeeded for
 *     admins / notification managers, under an auto-ID) is skipped — no duplicate.
 *   - Rows land isRead: true with createdAt = the original sentAt. They are history, not news:
 *     unread would light up a stale bell badge of 20+ for some employees.
 *
 * Auth: Application Default Credentials (`gcloud auth application-default login`).
 * Nothing here is required by index.js and firebase.json excludes scripts/ from the deploy.
 */

const { buildOpenSessionReminder } = require("../openSessionReminder");

const PUSH_ID = /^open-session-(.+)-(\d{4}-\d{2}-\d{2})$/;

/** IST "yyyy-mm-dd" of a millisecond instant. */
function istDate(millis) {
  return new Date(millis + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** "yyyy-mm-dd" + n days. */
function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * How late a client-saved copy can be and still count as THIS reminder's row. The old
 * client saved on arrival, which is later than the send if the phone was off.
 */
const CLIENT_COPY_WINDOW_DAYS = 2;

/**
 * PURE planner.
 * @param {Array<{id: string, recipientId: string, sentAtMillis: number}>} pushes
 * @param {Map<string, Array<{id: string, title: string, createdAtMillis: number|null}>>} rowsByUser
 *   every existing notification row per user; a user absent from the map no longer exists.
 * @returns {{ writes: Array<{userId, rowId, date, sentAtMillis}>, skipped: Array<{pushId, reason}> }}
 */
function planBackfill(pushes, rowsByUser) {
  const writes = [];
  const skipped = [];
  const consumed = new Set(); // a client copy accounts for ONE reminder, not every nearby day
  const ordered = [...pushes].sort((a, b) => a.id.localeCompare(b.id));
  for (const p of ordered) {
    const m = PUSH_ID.exec(p.id);
    if (!m) { skipped.push({ pushId: p.id, reason: "unrecognised id" }); continue; }
    const [, userId, date] = m;
    if (p.recipientId !== userId) { skipped.push({ pushId: p.id, reason: "recipient mismatch" }); continue; }
    const rows = rowsByUser.get(userId);
    if (!rows) { skipped.push({ pushId: p.id, reason: "user missing" }); continue; }

    const r = buildOpenSessionReminder(userId, date);
    if (rows.some((row) => row.id === r.inAppId)) {
      skipped.push({ pushId: p.id, reason: "row exists" });
      continue;
    }
    const clientCopy = rows.find((row) =>
      !consumed.has(`${userId}/${row.id}`) &&
      row.title === r.inApp.title &&
      row.createdAtMillis != null &&
      istDate(row.createdAtMillis) >= date &&
      istDate(row.createdAtMillis) <= addDays(date, CLIENT_COPY_WINDOW_DAYS));
    if (clientCopy) {
      consumed.add(`${userId}/${clientCopy.id}`);
      skipped.push({ pushId: p.id, reason: `client copy ${clientCopy.id}` });
      continue;
    }

    writes.push({ userId, rowId: r.inAppId, date, sentAtMillis: p.sentAtMillis });
  }
  return { writes, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const pi = args.indexOf("--project");
  const projectId = pi >= 0 ? args[pi + 1] : null;
  if (!projectId) { console.error("--project <id> is required"); process.exit(2); }

  const admin = require("firebase-admin");
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  const pushSnap = await db.collection("sent_notifications")
    .where("sentBy", "==", "openSessionReminder").get();
  const pushes = pushSnap.docs.map((d) => ({
    id: d.id,
    recipientId: d.get("recipientId"),
    sentAtMillis: d.get("sentAt")?.toMillis() ?? Date.now(),
  }));

  const userIds = [...new Set(pushes.map((p) => p.recipientId))];
  const rowsByUser = new Map();
  await Promise.all(userIds.map(async (uid) => {
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) return;
    const snap = await db.collection("users").doc(uid).collection("notifications").get();
    rowsByUser.set(uid, snap.docs.map((d) => ({
      id: d.id,
      title: d.get("title"),
      createdAtMillis: d.get("createdAt")?.toMillis() ?? null,
    })));
  }));

  const { writes, skipped } = planBackfill(pushes, rowsByUser);
  console.log(`project=${projectId} mode=${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`reminders=${pushes.length} toWrite=${writes.length} skipped=${skipped.length}`);
  for (const s of skipped) console.log(`  skip ${s.pushId}: ${s.reason}`);
  if (!apply) { console.log("Dry run — pass --apply to write."); return; }

  let created = 0, existed = 0;
  for (const w of writes) {
    const { inApp } = buildOpenSessionReminder(w.userId, w.date);
    try {
      await db.collection("users").doc(w.userId).collection("notifications").doc(w.rowId).create({
        ...inApp,
        isRead: true,
        createdAt: admin.firestore.Timestamp.fromMillis(w.sentAtMillis),
      });
      created++;
    } catch (e) {
      if (e.code === 6) { existed++; continue; } // ALREADY_EXISTS — never overwrite
      throw e;
    }
  }
  console.log(`created=${created} alreadyExisted=${existed}`);
}

module.exports = { planBackfill, istDate };

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
