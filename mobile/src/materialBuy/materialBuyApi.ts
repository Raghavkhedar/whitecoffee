import { collection, doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { auditStamp } from '../firebase/auditStamp';
import type { UserProfile } from '../attendance/attendanceApi';

export interface PurchaseItem {
  itemName: string;
  quantity: number;
  unit: string;
  pricePerUnit: number;
  totalPrice: number;
  spec1: string;
  spec2: string;
  notes: string;
}

export interface SubmitPurchaseInput {
  siteId: string;
  siteName: string;
  items: PurchaseItem[];
  notes: string;
}

// Mints the doc ref locally (a pure, synchronous operation — no network round trip), so the
// docId is available immediately for the caller to build a photo storage path with. The
// actual write below is offline-safe: setDoc(...).catch(...) without awaiting, same pattern
// as every prior phase.
export function submitMaterialPurchase(user: UserProfile, input: SubmitPurchaseInput): string {
  const purchaseRef = collection(db, 'users', user.uid, 'material_purchases');
  const docRef = doc(purchaseRef);
  const grandTotal = input.items.reduce((sum, item) => sum + item.totalPrice, 0);
  setDoc(docRef, {
    ...auditStamp(user.uid),
    userId: user.uid,
    userName: user.name,
    employeeId: user.employeeId,
    siteId: input.siteId,
    siteName: input.siteName,
    items: input.items,
    grandTotal,
    notes: input.notes,
    photoUrls: [],
    submittedAt: Timestamp.now(),
  }).catch((error) => {
    console.error('Failed to sync material purchase to server', error);
  });
  return docRef.id;
}

export async function updatePurchasePhotoUrls(uid: string, docId: string, urls: string[]): Promise<void> {
  const docRef = doc(db, 'users', uid, 'material_purchases', docId);
  // ⚠️ AUDIT-EXEMPT: the owner may change ONLY photoUrls (rules hasOnly) — no stamp.
  await updateDoc(docRef, { photoUrls: urls });
}
