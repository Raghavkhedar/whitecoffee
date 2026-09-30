import { collection, doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { auditStamp } from '../firebase/auditStamp';
import type { UserProfile } from '../attendance/attendanceApi';

// Material Transfer and Tool Transfer share an identical Firestore shape on Android
// (decision #9: "Transfer model shared — Material + Tool Transfer identical structure"),
// differing only in which collection they write to and their screen copy.
export type TransferCollection = 'material_transfers' | 'tool_transfers';

export interface TransferItem {
  itemName: string;
  quantity: number;
  unit: string;
  condition: string;
  spec1: string;
  spec2: string;
  make: string;
}

export interface SubmitTransferInput {
  fromLocation: string;
  toLocation: string;
  transferredBy: string;
  receivedBy: string;
  items: TransferItem[];
  notes: string;
}

// Android sets transferDate to LocalDate.now() in the device's own timezone (not a payroll
// date needing UTC-shifted IST computation like the Cloud Functions boundary) — this mirrors
// that with the device's local calendar date.
function todayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Same mint-then-write pattern as materialBuyApi.submitMaterialPurchase.
export function submitTransfer(
  collectionName: TransferCollection,
  user: UserProfile,
  input: SubmitTransferInput
): string {
  const transferRef = collection(db, 'users', user.uid, collectionName);
  const docRef = doc(transferRef);
  setDoc(docRef, {
    ...auditStamp(user.uid),
    userId: user.uid,
    userName: user.name,
    employeeId: user.employeeId,
    fromLocation: input.fromLocation,
    toLocation: input.toLocation,
    transferredBy: input.transferredBy,
    receivedBy: input.receivedBy,
    items: input.items,
    notes: input.notes,
    photoUrls: [],
    transferDate: todayDateString(),
    submittedAt: Timestamp.now(),
  }).catch((error) => {
    console.error(`Failed to sync ${collectionName} to server`, error);
  });
  return docRef.id;
}

export async function updateTransferPhotoUrls(
  collectionName: TransferCollection,
  uid: string,
  docId: string,
  urls: string[]
): Promise<void> {
  const docRef = doc(db, 'users', uid, collectionName, docId);
  // ⚠️ AUDIT-EXEMPT: the owner may change ONLY photoUrls (rules hasOnly) — no stamp.
  await updateDoc(docRef, { photoUrls: urls });
}
