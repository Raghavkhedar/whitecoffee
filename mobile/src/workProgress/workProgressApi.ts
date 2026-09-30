import { collection, doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { auditStamp } from '../firebase/auditStamp';
import type { UserProfile } from '../attendance/attendanceApi';

export interface SubmitWorkProgressInput {
  siteId: string;
  siteName: string;
  date: string; // yyyy-MM-dd
  workDescription: string;
}

/**
 * users/{uid}/work_progress — Android's WorkProgress.toMap() + audit stamp. hoursWorked is
 * always 0 (Android's form no longer asks for it; the field stays for schema parity). Written
 * with empty photoUrls, then patched once photos upload. Fire-and-forget: the id is minted
 * locally and returned so the caller can build photo paths.
 */
export function submitWorkProgress(user: UserProfile, input: SubmitWorkProgressInput): string {
  const docRef = doc(collection(db, 'users', user.uid, 'work_progress'));
  setDoc(docRef, {
    ...auditStamp(user.uid),
    userId: user.uid,
    userName: user.name,
    employeeId: user.employeeId,
    siteId: input.siteId,
    siteName: input.siteName,
    date: input.date,
    hoursWorked: 0,
    workDescription: input.workDescription,
    photoUrls: [],
    submittedAt: Timestamp.now(),
  }).catch((error) => console.error('Failed to sync work progress to server', error));
  return docRef.id;
}

export async function updateWorkProgressPhotoUrls(uid: string, docId: string, urls: string[]): Promise<void> {
  // ⚠️ AUDIT-EXEMPT: the owner may change ONLY photoUrls (rules hasOnly) — no stamp.
  await updateDoc(doc(db, 'users', uid, 'work_progress', docId), { photoUrls: urls });
}
