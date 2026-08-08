"use strict";

/**
 * Unclosed day — auto-file a regularization request for a day that scored LNF.
 *
 * THE PROBLEM: an employee who checks IN and forgets to check OUT leaves the day with a
 * single punch. The nightly scorer (`computeDailyAttendanceStatus`) has nothing to measure
 * against a window, so it scores the day **LNF** ("Log Not Found") — which is HALF PAY.
 * Nothing tells the employee. Nothing tells the admin. The deduction is discovered weeks
 * later when a payslip is queried, by which point the day is unreconstructable from memory.
 * That is what happened on 2026-08-07.
 *
 * THE FIX IS THE EXISTING WORKFLOW, NOT A NEW ONE. Regularization already solves a
 * wrongly-scored day: the employee files a request, an admin approves it, and the approval
 * atomically rewrites `attendance_status` (see key decision #27). The workflow is sound; its
 * only failure mode is that it starts with the employee NOTICING. So we file the request on
 * their behalf and put the day in front of an admin the next morning, while it can still be
 * remembered. The admin decision itself is untouched — nothing here approves anything.
 *
 * NO CALENDAR ARITHMETIC HAPPENS IN THIS MODULE. The day key arrives already computed as an
 * IST "yyyy-mm-dd" (it is the `attendance_status` document ID). If a future change ever needs
 * to DERIVE a date here, require `istDateOf` from `./punchIntegrity` — cloud functions run on
 * a UTC clock (see root CLAUDE.md) and a bare `new Date()`/`getDay()` yields the wrong IST day
 * for eight and a half hours of every day. Do not write a second copy of that helper.
 *
 * Pure and Firestore-free so it can be unit-tested with `node --test`. The caller does the
 * reads, converts `submittedAt` to a Firestore Timestamp, and writes the document.
 */

/** The scored status this exists for: punched in, never punched out. */
const UNCLOSED_STATUS = "LNF";

/** Only a machine-scored day may be auto-filed. See `needsAutoRegularization`. */
const AUTO_MARKED_BY = "auto";

/** Request states that mean this day is already in the workflow and must not be re-filed. */
const BLOCKING_REQUEST_STATES = ["pending", "approved"];

/**
 * The `reason` written onto the auto-filed request.
 *
 * An admin reading the queue sees this text and nothing else about where the request came
 * from, so it has to explain itself: what the system observed, what it scored, and what the
 * admin is being asked to decide. Employee-written reasons are free text; this one is a
 * constant precisely so it is recognisable at a glance across the whole queue.
 */
const AUTO_FILED_REASON =
  "Auto-filed by the system: a check-in was recorded for this day but no check-out, " +
  "so the day scored LNF (Log Not Found) automatically, which pays half a day. " +
  "Please confirm the actual working hours with the employee and set the correct status.";

/**
 * Should the system file a regularization request for this scored day?
 *
 * @param {object} status           the `attendance_status` doc, e.g.
 *                                  `{ status: "LNF", markedBy: "auto", date: "2026-08-07" }`
 * @param {Array<object>} existingRequests  regularization_requests already present for this
 *                                  user+date
 * @returns {boolean}
 */
function needsAutoRegularization(status, existingRequests) {
  if (!status) return false;

  // 1. ONLY LNF. Deliberately NOT `Absent`. An Absent day has no punches at all, which is
  //    the normal, correct scoring for a genuine absence, an uncovered leave gap, a joiner
  //    who has not started, or anyone off the roster — auto-filing those would put a request
  //    in the admin queue for every legitimate non-working day and bury the real ones. LNF is
  //    narrow and diagnostic: it can ONLY arise from one punch, which is the forgot-to-check-
  //    out signature. Everything else (Present, SL, HalfDay, PL, LWP, WO) is a day the scorer
  //    had both punches (or a leave record) for, and is not this bug.
  if (status.status !== UNCLOSED_STATUS) return false;

  // 2. The day must be MACHINE-scored. `markedBy: "admin"` means a human already looked at
  //    this day and decided it — an admin override is sacred across this codebase (it is why
  //    the nightly scorer skips those docs entirely, key decision #28). Auto-filing against
  //    one would ask an admin to re-litigate their own ruling and, if approved, overwrite it.
  //    `backfill` is likewise a deliberate human-run correction and is not auto.
  if (status.markedBy !== AUTO_MARKED_BY) return false;

  // 3. Don't file twice. This mirrors the client's duplicate check exactly
  //    (FirestoreRegularizationRepository.submitRequest): `pending` means the admin already
  //    has it, `approved` means the day is already resolved — but a `rejected` request must
  //    NOT block. A rejection is a decision about one submission, not a permanent bar on the
  //    day, and the employee can re-file after one; the system gets the same latitude.
  const requests = Array.isArray(existingRequests) ? existingRequests : [];
  const blocked = requests.some((r) => {
    if (!r) return false;
    // Tolerate an unfiltered list: a request carrying a different `date` is about another
    // day. A request with no `date` is assumed to be for this one (caller pre-filtered).
    if (r.date && status.date && r.date !== status.date) return false;
    return BLOCKING_REQUEST_STATES.includes(r.status);
  });

  return !blocked;
}

/**
 * Build the regularization_requests document to write for an auto-filed day.
 *
 * Fields are DENORMALISED (userName/employeeId alongside userId) because the admin portal
 * reads this collection through a `collectionGroup` query — it never has the parent user doc
 * in hand, so anything it needs to display must live on the request itself.
 *
 * Deliberately ABSENT: `approvedBy`, `approverComment`, `approvedStatus`, `reviewedAt`. Those
 * are the admin's decision, and that has not happened. Writing empty strings for them would
 * make an unreviewed request indistinguishable from a reviewed one at the schema level.
 *
 * @param {object} args
 * @param {object} args.user      the user doc — reads `userId`/`id`, `name`, `employeeId`
 * @param {string} args.date      IST day key "yyyy-mm-dd" being regularized
 * @param {object} args.status    the scored `attendance_status` doc (source of originalStatus)
 * @param {number} args.nowMillis epoch millis for `submittedAt` — INJECTED, never read from
 *                                the clock here, so this module stays pure and deterministic
 * @returns {object} the document to write; `submittedAt` is an **ISO-8601 UTC string** —
 *                   the caller converts it to a Firestore Timestamp
 */
function buildAutoRegularization(args) {
  const { user, date, status, nowMillis } = args || {};
  const u = user || {};
  const s = status || {};

  return {
    userId: u.userId || u.id || "",
    userName: u.name || "",
    employeeId: u.employeeId || "",
    date: date || s.date || "",
    originalStatus: s.status || "",
    reason: AUTO_FILED_REASON,
    // Always pending. The security rules only permit a request to be CREATED pending, and
    // more importantly this function decides nothing about the day — it opens the question.
    status: "pending",
    // WHY THIS MARKER EXISTS: without it, a system-filed request is byte-identical in kind to
    // one the employee wrote, and the admin cannot tell whether a human is asserting "I worked
    // that day" or whether a scheduler noticed a missing punch. The admin UI needs to label it
    // ("auto-filed"), the queue needs to be able to sort/filter on it, and later — when someone
    // audits how an LNF day became Present — it is the only evidence of who started the chain.
    // It is also the safety valve: if this ever misfires, every request it created is findable.
    autoFiled: true,
    // Derived from the injected clock, never `new Date()`. ISO-8601 UTC string.
    submittedAt: typeof nowMillis === "number" && isFinite(nowMillis)
      ? new Date(nowMillis).toISOString()
      : null,
  };
}

module.exports = { needsAutoRegularization, buildAutoRegularization, AUTO_FILED_REASON };
