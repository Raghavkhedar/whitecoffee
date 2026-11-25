"use strict";

/**
 * Pure builders for transfer receipt confirmation: the notifications a transfer write calls
 * for, and the names-only `directory/{uid}` entry the receiver picker reads.
 * Like openSessionReminder.js, each notice is a push AND a bell row, with deterministic IDs.
 */

function itemSummary(items) {
  const list = Array.isArray(items) ? items : [];
  const shown = list.slice(0, 3).map((i) => `${i.itemName} x${i.quantity}`).join(", ");
  return list.length > 3 ? `${shown} +${list.length - 3} more` : shown;
}

function buildReceiptNotices({ before, after, collection, docId, senderId, adminIds = [] }) {
  if (!after || !after.receiverId) return [];
  const status = after.receiptStatus || "pending";
  if (before && (before.receiptStatus || "pending") === status) return [];

  const kind = collection === "tool_transfers" ? "Tool" : "Material";
  const items = itemSummary(after.items);
  let title;
  let body;
  let recipients;
  if (!before) {
    title = `${kind} transfer to confirm`;
    body = `${after.userName || "A colleague"} sent you ${items}. Confirm in the app once it arrives.`;
    recipients = [after.receiverId];
  } else if (status === "received") {
    const who = after.lastModifiedBy === after.receiverId ? after.receivedBy : "The office";
    title = `${kind} transfer received`;
    body = `${who} marked ${items} as received.`;
    recipients = [senderId];
  } else if (status === "problem") {
    title = `${kind} transfer problem`;
    body = `${after.receivedBy} reported a problem with ${items}: ${after.receiptNote}`;
    recipients = [...new Set([senderId, ...adminIds])];
  } else {
    return [];
  }

  return recipients.map((userId) => {
    const message = { title, body, type: "general" };
    const id = `transfer-${docId}-${status}`;
    return {
      userId,
      pushId: `${id}-${userId}`,
      push: { ...message, recipientType: "specific", recipientId: userId, sentBy: "transferReceipt" },
      inAppId: id,
      inApp: { ...message, isRead: false },
    };
  });
}

/** The directory doc to write, `null` to delete it, or `undefined` when nothing in it changed. */
function directoryEntry(before, after) {
  if (!after) return null;
  const pick = (u) => ({ name: u.name || "", employeeId: u.employeeId || "", active: u.active !== false });
  const next = pick(after);
  if (before && JSON.stringify(pick(before)) === JSON.stringify(next)) return undefined;
  return next;
}

module.exports = { buildReceiptNotices, directoryEntry };
