// The transactional core of `cancelLeave` (src/lib/firestore.ts): every read and every write of a
// leave cancellation, run as ONE client-SDK Firestore transaction.
//
// ── Why a transaction ─────────────────────────────────────────────────────────────────────────
// `cancelLeave` used to read the leave, the day statuses and the holidays with plain reads and
// then commit an unconditional batch. The `scoreRetroactiveLeave` Cloud Function (a transaction on
// users/{uid}, the leave and the status docs — firebase/functions/retroLeaveRunner.js) could commit
// in that gap, leaving a PAID `SCHL` day on a cancelled leave and a PL day consumed with no refund.
// Here the same docs are read AND written in one transaction, so whichever writer commits second
// is aborted and re-runs against fresh data. Design:
// docs/superpowers/specs/2026-09-21-transactional-nightly-and-cancel-design.md §1.1, §2 Option D, §3.4.
//
// ── Why this file takes its Firestore functions as arguments ──────────────────────────────────
// It imports NOTHING from `firebase/*` at runtime (type-only imports are erased) and nothing that
// initialises the app (`./firebase` needs NEXT_PUBLIC_* env). `db`, the handful of `firebase/firestore`
// functions it needs, and `stamped()` are handed in by `cancelLeave`. That is what lets the
// firebase/rules-tests emulator suite load THIS file and run the REAL transaction against the real
// firestore.rules with its own copy of the SDK — see firebase/rules-tests/cancel-leave-transaction.test.js.
// Keep it that way: do not add a runtime import of `firebase/firestore`, `./firebase` or `./firestore`.
//
// ── Rules of the road (each one is pinned by a test or a mutation) ────────────────────────────
//  1. ALL reads happen before ANY write (the SDK enforces it: a `tx.get` after a write throws).
//  2. The transaction callback RE-EXECUTES on contention (up to 5 attempts), so every accumulator
//     (`plan`, skippedDates, refundedDays) is derived INSIDE the callback and the result is the
//     transaction's return value — never a variable closed over from outside. This repo has been
//     bitten by exactly this shape (see the `missingStatusDates = 0` reset in firebase/functions/index.js).
//  3. The leave is re-read INSIDE the transaction and `cancelling` is re-derived from that copy, so
//     a concurrent cancellation by another admin is seen on the retry instead of double-refunded.
//  4. A client transaction cannot run queries (`tx.get` takes a DocumentReference only), so the
//     holiday range query `getHolidaysForDateRange` is replaced by one `tx.get(holidays/{date})`
//     per cancelling date. `holidays/{date}` is readable by any signed-in user.
//  5. The per-date decisions (rest-day skip by DATE, `markedBy === 'auto'` gate, refund rule) are
//     unchanged and live in the pure planner, leaveCancellation.ts.

import type * as FS from 'firebase/firestore';
import {
  MAX_CANCEL_DATES, cancelCapError, planLeaveCancellation, resolveCancellingDates, type StatusDocLike,
} from './leaveCancellation';
import type { LeaveLike } from './leaveDates';

export { MAX_CANCEL_DATES };

/** The `firebase/firestore` functions the core calls — injected so the caller chooses the SDK copy. */
export type CancelLeaveFirestoreFns = Pick<
  typeof FS, 'doc' | 'runTransaction' | 'increment' | 'deleteField' | 'Timestamp'
>;

export interface CancelLeaveDeps {
  db: FS.Firestore;
  fns: CancelLeaveFirestoreFns;
  /** Write attribution (`stamped()` in firestore.ts). Applied to every write, exactly as before. */
  stamp: <T extends object>(data: T) => T;
}

export interface CancelLeaveArgs {
  userId: string;
  leaveId: string;
  /** The caller's (possibly stale) list. Re-derived against the in-transaction leave. */
  datesToCancel: readonly string[];
  cancelledBy: string;
  /** Already trimmed and non-empty — that validation stays in `cancelLeave`, outside the transaction. */
  cancelComment: string;
  /**
   * TEST HOOK, never passed in production. Called on EVERY attempt, after all reads and before any
   * write — the one point where a competing writer's commit is guaranteed to invalidate this
   * attempt. The emulator suite uses it to reproduce the `scoreRetroactiveLeave` race
   * deterministically.
   */
  onAfterReads?: () => void | Promise<void>;
}

export interface CancelLeaveResult {
  cancelled: string[];
  skippedDates: string[];
  refundedDays: number;
}

type LeaveDoc = LeaveLike & { status?: string };

export function runCancelLeaveTransaction(deps: CancelLeaveDeps, args: CancelLeaveArgs): Promise<CancelLeaveResult> {
  const { db, fns, stamp } = deps;
  const { doc, runTransaction, increment, deleteField, Timestamp } = fns;
  const { userId, leaveId, datesToCancel, cancelledBy, cancelComment, onAfterReads } = args;

  const leaveRef = doc(db, 'users', userId, 'leave_requests', leaveId);
  const userRef = doc(db, 'users', userId);
  const statusRefOf = (date: string) => doc(db, 'users', userId, 'attendance_status', date);
  const holidayRefOf = (date: string) => doc(db, 'holidays', date);

  // Everything below runs once per ATTEMPT. Nothing that outlives an attempt is declared out here.
  return runTransaction(db, async (tx): Promise<CancelLeaveResult> => {
    // ── reads ────────────────────────────────────────────────────────────────────────────────
    const leaveSnap = await tx.get(leaveRef);
    if (!leaveSnap.exists()) throw new Error('cancelLeave: leave request not found.');
    const leave = { id: leaveSnap.id, ...leaveSnap.data() } as LeaveDoc & { id: string };
    if (leave.status !== 'approved') {
      throw new Error('cancelLeave: only an approved leave can be cancelled.');
    }

    // Re-derive what is still granted from the IN-TRANSACTION copy rather than trusting the
    // caller's list: a stale tab (or an admin who cancelled a moment ago) could otherwise
    // "cancel" a day that is already cancelled and double-refund it. (Pure — leaveCancellation.ts.)
    const cancelling = resolveCancellingDates(leave, datesToCancel);
    if (cancelling.length === 0) {
      throw new Error('cancelLeave: none of those dates are currently granted by this leave.');
    }
    const capError = cancelCapError(cancelling.length);
    if (capError) throw new Error(capError);

    const [statusSnaps, holidaySnaps] = await Promise.all([
      Promise.all(cancelling.map(d => tx.get(statusRefOf(d)))),
      Promise.all(cancelling.map(d => tx.get(holidayRefOf(d)))),
    ]);

    const statusByDate = new Map<string, StatusDocLike>();
    const holidaySet = new Set<string>();
    cancelling.forEach((date, i) => {
      if (statusSnaps[i].exists()) statusByDate.set(date, statusSnaps[i].data() as StatusDocLike);
      if (holidaySnaps[i].exists()) holidaySet.add(date);
    });

    // Every per-date decision — the rest-date skip (silent, by DATE), no doc, a Sunday/Holiday
    // doc, a non-leave status, the `markedBy === 'auto'` gate, the refund rule — lives in the
    // pure planner; this function only does the I/O around it.
    const plan = planLeaveCancellation({ leave, datesToCancel, statusByDate, holidaySet });

    if (onAfterReads) await onAfterReads();

    // ── writes ───────────────────────────────────────────────────────────────────────────────
    for (const date of plan.reverts) {
      tx.set(
        statusRefOf(date),
        // salaryCredit is cleared with the revert (no stale credit left on an Absent doc). The
        // planner decided the refund from the snapshot read in THIS transaction.
        stamp({ status: 'Absent', markedBy: 'admin', salaryCredit: deleteField(), updatedAt: Timestamp.now() }),
        { merge: true },
      );
    }

    if (plan.refundedDays > 0) {
      tx.update(userRef, stamp({ plBalance: increment(plan.refundedDays) }));
    }

    // Union, never overwrite — a second cancellation must not un-cancel the first.
    tx.update(leaveRef, stamp({
      cancelledDates:  plan.mergedCancelledDates,
      cancelledBy,
      cancelComment,
      lastCancelledAt: Timestamp.now(),
    }));

    return { cancelled: plan.cancelling, skippedDates: plan.skippedDates, refundedDays: plan.refundedDays };
  });
}
