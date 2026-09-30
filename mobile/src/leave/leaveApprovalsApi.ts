import { collectionGroup, doc, onSnapshot, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { auditStamp } from '../firebase/auditStamp';

export interface PendingLeave {
  id: string;
  userId: string;
  userName: string;
  employeeId: string;
  fromDate: string;
  toDate: string;
  totalDays: number;
  reason: string;
  placeOfVisit: string;
  submittedAt: number;
}

/**
 * Every pending leave request, oldest first. Reads the WHOLE leave_requests collection group
 * and filters on the device, like the admin portal's getLeaveRequests — a where('status')
 * collection-group query needs a COLLECTION_GROUP index that isn't declared in
 * firebase/firestore.indexes.json (and an undeclared one is pruned on deploy).
 */
export function subscribePendingLeaves(
  onChange: (items: PendingLeave[]) => void,
  onError: (message: string) => void,
): () => void {
  return onSnapshot(
    collectionGroup(db, 'leave_requests'),
    (snap) => {
      const items = snap.docs
        .filter((d) => d.data().status === 'pending')
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            // The path is authoritative for whose request this is (the create rule pins
            // userId to the path, but read the path anyway).
            userId: d.ref.parent.parent?.id ?? String(data.userId ?? ''),
            userName: String(data.userName ?? ''),
            employeeId: String(data.employeeId ?? ''),
            fromDate: String(data.fromDate ?? ''),
            toDate: String(data.toDate ?? ''),
            totalDays: Number(data.totalDays ?? 0),
            reason: String(data.reason ?? ''),
            placeOfVisit: String(data.placeOfVisit ?? ''),
            submittedAt: (data.submittedAt as Timestamp | undefined)?.toMillis() ?? 0,
          };
        })
        .sort((a, b) => a.submittedAt - b.submittedAt);
      onChange(items);
    },
    (e) => {
      console.error('Pending leaves subscription failed', e);
      onError("Couldn't load leave requests.");
    },
  );
}

/**
 * AWAITED, unlike the employee's own writes — do not "fix" the asymmetry. This writes to
 * ANOTHER user's document, the one leave path the rules can refuse; reporting success for an
 * approval the server then rejects would leave an admin believing leave was granted.
 * No approvedDates = the whole range is granted (the portal's own compatibility rule).
 * The scoreRetroactiveLeave trigger takes it from there, whoever wrote it.
 */
export async function approveLeave(userId: string, requestId: string, approverName: string, actorUid: string): Promise<void> {
  await updateDoc(doc(db, 'users', userId, 'leave_requests', requestId), {
    status: 'approved',
    approvedBy: approverName,
    reviewedAt: Timestamp.now(),
    ...auditStamp(actorUid),
  });
}

export async function rejectLeave(
  userId: string,
  requestId: string,
  approverName: string,
  comment: string,
  actorUid: string,
): Promise<void> {
  await updateDoc(doc(db, 'users', userId, 'leave_requests', requestId), {
    status: 'rejected',
    approvedBy: approverName,
    approverComment: comment,
    reviewedAt: Timestamp.now(),
    ...auditStamp(actorUid),
  });
}
