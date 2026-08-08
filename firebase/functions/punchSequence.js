"use strict";

/**
 * Punch sequence — is this punch structurally possible given the rest of the day?
 *
 * WHY THIS EXISTS. On 2026-08-08 employee S338's app woke up still holding YESTERDAY's
 * in-memory state and authorised an `office_out` as the FIRST event of the new day, with
 * no `office_in` open anywhere. Nothing noticed. The previous day was left with an
 * `office_in` and no `office_out`, and the nightly scorer read that as LNF — half a day's
 * pay gone, from a bug in the app's state, not in the employee's attendance. A punch can
 * be individually plausible (honest timestamp, honest GPS, honest clock — punchIntegrity.js
 * finds nothing wrong with it) and still be impossible in SEQUENCE. That gap is this file.
 *
 * DETECTION, NOT PREVENTION — the same contract as punchIntegrity.js, for the same reason:
 * punches are written by the client SDK so they survive a site with no signal, and are
 * never rejected server-side. This module returns a verdict. It never rejects, deletes,
 * repairs or throws. A flag is a signal for a human to look at the day, nothing more.
 *
 * ORDER BY TIMESTAMP, NEVER BY ARRIVAL. An offline device syncs whenever it next sees a
 * network, so the 09:00 check-in can be WRITTEN after the 17:00 check-out. Walking the day
 * in arrival order would report an orphan_out on nearly every offline day. The whole day is
 * therefore sorted by timestamp and assessed as-if-complete.
 *
 * The corollary, accepted deliberately: a punch that arrives LATER can retroactively make
 * an earlier verdict wrong — the 17:00 `office_out` genuinely looks orphaned until the
 * 09:00 `office_in` finally syncs. Nothing here goes back and rewrites the earlier flag.
 * That is fine precisely because this is a signal and not an enforcement gate; the day is
 * re-derivable in full at any time from the punches themselves.
 *
 * PER-ROLE EVENT TYPES. Which types open and close a day differs by role and comes from
 * roleCapabilities.js. Never hardcode them and never write `role === "operations" ? … : …`
 * — that binary silently drops `sales` (office + site + market check-ins) into the office
 * branch, which in this repo is a known source of payroll bugs, not a cosmetic one.
 *
 * `home_in` / `home_out` are COMMUTE markers. They are in neither capability list, they do
 * not open or close a worked day, and they are ignored here entirely.
 *
 * Pure and Firestore-free so it can be unit-tested with `node --test`.
 */

const { attendanceInTypes, attendanceOutTypes } = require("./roleCapabilities");
const { toMillis } = require("./punchIntegrity");

/** The verdicts this module can return. Frozen — callers compare, never mutate. */
const SEQUENCE_FLAGS = Object.freeze({
  /** An out-type punch with no open in-type punch before it (the S338 bug). */
  ORPHAN_OUT: "orphan_out",
  /** An in-type punch while a previous in-type punch is still open. */
  DOUBLE_IN: "double_in",
});

/**
 * Assess one punch against the whole day it belongs to.
 *
 * @param {object} punch      the newly written attendance event ({type, timestamp, …})
 * @param {Array<object>} dayPunches ALL punches for that user on that date, INCLUDING
 *        `punch` itself, in any order (they arrive in sync order, not clock order)
 * @param {string} role       "office" | "operations" | "sales" | "admin"; anything else
 *        falls back to office via roleCapabilities — the most restrictive default
 * @returns {{flags: string[]}} verdict about `punch` ONLY, never about the day. At most
 *          one flag today (a punch is either in-type or out-type, not both); the array
 *          shape leaves room for further sequence checks without changing the contract.
 */
function assessSequence(punch, dayPunches, role) {
  const flags = [];
  if (!punch || typeof punch !== "object") return { flags };

  const inTypes = attendanceInTypes(role);
  const outTypes = attendanceOutTypes(role);

  // Not a day-opening or day-closing event for this role — commute markers (home_in /
  // home_out), or a type this role does not use at all. Nothing to say about it.
  if (!isSequenced(punch, inTypes, outTypes)) return { flags };

  // No usable timestamp means no position in the day. We deliberately do NOT fall back to
  // arrival order to place it: a guessed position would manufacture a flag against an
  // employee out of missing data. punchIntegrity already flags the missing timestamp.
  const punchMs = toMillis(punch.timestamp);
  if (punchMs === null) return { flags };

  const seq = sequencedPunches(dayPunches, inTypes, outTypes);

  // Locate `punch` inside the day. The trigger re-reads the day from Firestore, so the
  // element representing this punch is usually a different object than the one handed in.
  let ti = findTarget(seq, punch, punchMs);
  if (ti === -1) {
    // `punch` is not in `dayPunches` — a stale or partial read. Assess it anyway, in its
    // rightful place on the clock; silently returning no verdict would lose the signal.
    seq.push({ punch, ms: punchMs, target: false });
    ti = seq.length - 1;
  }
  seq[ti].target = true;

  // Clock order, not arrival order. Array#sort is stable, so punches sharing a timestamp
  // keep the order they were written in.
  seq.sort((a, b) => a.ms - b.ms);

  // Walk the day as a single open/closed state. A day is open or it is not — there is no
  // nesting to count, because nobody is at two places at once.
  let open = false;
  let verdict = null;
  for (const entry of seq) {
    let flag = null;
    if (inTypes.includes(entry.punch.type)) {
      // A second check-in over an open one. The day stays open: the earlier in-punch is
      // still the one that opened it, and the duplicate is the anomaly.
      if (open) flag = SEQUENCE_FLAGS.DOUBLE_IN;
      open = true;
    } else {
      // Out with nothing open — the impossible event. The day stays closed, so a
      // subsequent out is reported on its own merits rather than inheriting this one.
      if (!open) flag = SEQUENCE_FLAGS.ORPHAN_OUT;
      open = false;
    }
    if (entry.target) verdict = flag;
  }

  if (verdict) flags.push(verdict);
  return { flags };
}

/**
 * The day reduced to just its day-opening and day-closing punches, each placed on the clock.
 *
 * Only punches that open or close a day, and only those carrying a usable timestamp —
 * anything else is skipped rather than guessed at. Not sorted; callers sort, because
 * `assessSequence` must first mark its target inside the list.
 */
function sequencedPunches(dayPunches, inTypes, outTypes) {
  const seq = [];
  const all = Array.isArray(dayPunches) ? dayPunches : [];
  for (const p of all) {
    if (!p || typeof p !== "object") continue;
    if (!isSequenced(p, inTypes, outTypes)) continue;
    const ms = toMillis(p.timestamp);
    if (ms === null) continue;
    seq.push({ punch: p, ms, target: false });
  }
  return seq;
}

/**
 * Is this day still OPEN — checked in with no matching check-out?
 *
 * This is the forgot-to-check-out signature, and it is what the evening reminder pushes on.
 * It shares `sequencedPunches` with `assessSequence` deliberately: two copies of "which
 * events count and how is the day ordered" is exactly how the reminder starts disagreeing
 * with the flagging, and this repo has been bitten by duplicated rules before.
 *
 * The state is decided entirely by the LAST sequenced punch of the day: an in-type opens,
 * an out-type closes, and nothing nests because nobody is in two places at once. A day with
 * no sequenced punches at all is not open — an employee who never checked in has not
 * forgotten to check out, and must never be nagged.
 *
 * @param {Array<object>} dayPunches all of that user's punches for the day, any order
 * @param {string} role  role name; unknown falls back to office via roleCapabilities
 * @returns {boolean}
 */
function isDayOpen(dayPunches, role) {
  const inTypes = attendanceInTypes(role);
  const outTypes = attendanceOutTypes(role);
  const seq = sequencedPunches(dayPunches, inTypes, outTypes);
  if (seq.length === 0) return false;
  seq.sort((a, b) => a.ms - b.ms);
  return inTypes.includes(seq[seq.length - 1].punch.type);
}

/** Does this event open or close a worked day for the role? (Commute markers do not.) */
function isSequenced(p, inTypes, outTypes) {
  return typeof p.type === "string" &&
    (inTypes.includes(p.type) || outTypes.includes(p.type));
}

/**
 * Index of `punch` within the day, by identity then by id then by shape.
 *
 * When only the shape matches we take the LAST candidate: identical type at an identical
 * instant means a duplicate, and the punch being assessed is the one that just arrived —
 * the later of the pair. Guessing the earlier one would hide the very double_in we want.
 *
 * @returns {number} index, or -1 when the punch is absent from the day
 */
function findTarget(seq, punch, punchMs) {
  const byRef = seq.findIndex((e) => e.punch === punch);
  if (byRef !== -1) return byRef;

  const id = punch.id != null ? punch.id : punch.docId;
  if (id != null) {
    const byId = seq.findIndex((e) => {
      const other = e.punch.id != null ? e.punch.id : e.punch.docId;
      return other != null && other === id;
    });
    if (byId !== -1) return byId;
  }

  let byShape = -1;
  for (let i = 0; i < seq.length; i++) {
    const e = seq[i];
    if (e.punch.type !== punch.type || e.ms !== punchMs) continue;
    // A KNOWN-different id is proof this is some other document, however alike it looks.
    const other = e.punch.id != null ? e.punch.id : e.punch.docId;
    if (id != null && other != null && other !== id) continue;
    byShape = i;
  }
  return byShape;
}

module.exports = { assessSequence, isDayOpen, SEQUENCE_FLAGS };
