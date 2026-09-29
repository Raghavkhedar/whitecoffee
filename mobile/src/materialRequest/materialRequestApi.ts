import { collection, doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import type { UserProfile } from '../attendance/attendanceApi';

export interface RequestItem {
  itemName: string;
  quantity: number;
  unit: string;
  spec1: string;
  spec2: string;
  notes: string;
}

export interface SubmitRequestInput {
  siteId: string;
  siteName: string;
  items: RequestItem[];
  notes: string;
}

// Same mint-then-write pattern as materialBuyApi.submitMaterialPurchase: the docId is
// available synchronously for a photo storage path before the offline-safe write settles.
export function submitMaterialRequest(user: UserProfile, input: SubmitRequestInput): string {
  const requestRef = collection(db, 'users', user.uid, 'material_requests');
  const docRef = doc(requestRef);
  setDoc(docRef, {
    userId: user.uid,
    userName: user.name,
    employeeId: user.employeeId,
    siteId: input.siteId,
    siteName: input.siteName,
    items: input.items,
    notes: input.notes,
    photoUrls: [],
    submittedAt: Timestamp.now(),
  }).catch((error) => {
    console.error('Failed to sync material request to server', error);
  });
  return docRef.id;
}

export async function updateRequestPhotoUrls(uid: string, docId: string, urls: string[]): Promise<void> {
  const docRef = doc(db, 'users', uid, 'material_requests', docId);
  await updateDoc(docRef, { photoUrls: urls });
}
