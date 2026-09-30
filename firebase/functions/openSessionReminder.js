"use strict";

/**
 * Open-session reminder — the two documents the 18:30 IST "still checked in" nudge writes.
 *
 * 1. `sent_notifications/{pushId}` — sendPushNotification fans this out to FCM.
 * 2. `users/{uid}/notifications/{inAppId}` — the in-app bell row.
 *
 * The in-app row is written HERE, server-side, because no client can: firestore.rules
 * deliberately has no owner-create on users/{uid}/notifications (it let employees forge
 * company messages), so the old Android behaviour of saving a copy in
 * FcmService.onMessageReceived was PERMISSION_DENIED for every normal employee and the
 * reminder never reached the list. The admin portal writes its own rows for its own sends,
 * which is why sendPushNotification does NOT write one generically — that would duplicate
 * every admin broadcast.
 *
 * Both IDs are deterministic per user per IST day, so a scheduler retry `set`s the same
 * paths: no second push (the trigger fires on CREATE only) and no second bell row.
 *
 * Pure and Firestore-free so it can be unit-tested with `node --test`. The caller adds the
 * `sentAt` / `createdAt` Timestamps and performs the writes.
 */

const TITLE = "You are still checked in";
const BODY =
  "Your day has no check-out yet. Please check out in the app — an unclosed day is recorded as a half day.";
const TYPE = "attendance";

/**
 * @param {string} userId
 * @param {string} today IST "yyyy-mm-dd"
 */
function buildOpenSessionReminder(userId, today) {
  return {
    pushId: `open-session-${userId}-${today}`,
    push: {
      title: TITLE,
      body: BODY,
      type: TYPE,
      recipientType: "specific",
      recipientId: userId,
      sentBy: "openSessionReminder",
    },
    inAppId: `open-session-${today}`,
    inApp: {
      title: TITLE,
      body: BODY,
      type: TYPE,
      isRead: false,
    },
  };
}

module.exports = { buildOpenSessionReminder };
