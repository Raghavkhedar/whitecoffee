import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/config';

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: string;
  isRead: boolean;
  createdAt: number | null;
}

const col = (uid: string) => collection(db, 'users', uid, 'notifications');

/** Latest 50, newest first — same query as Android's observeNotifications. */
export function subscribeNotifications(uid: string, onChange: (items: AppNotification[]) => void): () => void {
  return onSnapshot(
    query(col(uid), orderBy('createdAt', 'desc'), limit(50)),
    (snap) =>
      onChange(
        snap.docs
          .map((d) => {
            const data = d.data();
            if (typeof data.title !== 'string') return null; // Android drops a doc with no title too
            return {
              id: d.id,
              title: data.title,
              body: String(data.body ?? ''),
              type: String(data.type ?? 'general'),
              isRead: data.isRead === true,
              createdAt: (data.createdAt as Timestamp | undefined)?.toMillis() ?? null,
            };
          })
          .filter((n): n is AppNotification => n !== null),
      ),
    (e) => console.error('Notifications subscription failed', e),
  );
}

export function subscribeUnreadCount(uid: string, onChange: (count: number) => void): () => void {
  return onSnapshot(
    query(col(uid), where('isRead', '==', false)),
    (snap) => onChange(snap.size),
    // Keep the last count on a transient error, like Android.
    (e) => console.warn('Unread count subscription failed', e),
  );
}

// ⚠️ AUDIT-EXEMPT (both below): the owner may change ONLY isRead (rules hasOnly) — a stamp
// would be denied and the badge would never clear. Not awaited, so it clears offline too.
export function markAsRead(uid: string, id: string): void {
  updateDoc(doc(db, 'users', uid, 'notifications', id), { isRead: true }).catch((e) =>
    console.error('Mark as read failed', e),
  );
}

export async function markAllAsRead(uid: string): Promise<void> {
  const unread = await getDocs(query(col(uid), where('isRead', '==', false)));
  if (unread.empty) return;
  const batch = writeBatch(db);
  unread.docs.forEach((d) => batch.update(d.ref, { isRead: true }));
  batch.commit().catch((e) => console.error('Mark all as read failed', e));
}
