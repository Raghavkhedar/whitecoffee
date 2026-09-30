import { Timestamp } from 'firebase/firestore';
import { auth } from './config';

/**
 * lastModifiedBy / lastModifiedAt — the actor stamp Android puts on every client write (its
 * AuditStamp.kt). The audit log is a Firestore trigger with no auth context, so the document
 * must name its writer; the rules deny a lastModifiedBy that isn't the caller.
 *
 * ⚠️ NOT for every write. Rules pin some owner-updates to an exact key set (hasOnly), where one
 * extra key is PERMISSION_DENIED: users/{uid} (activeSessionToken/fcmToken), notifications
 * (isRead), and the photoUrls patch on submissions. Those call sites are marked AUDIT-EXEMPT.
 */
export function auditStamp(fallbackUid: string): { lastModifiedBy: string; lastModifiedAt: Timestamp } {
  return { lastModifiedBy: auth.currentUser?.uid || fallbackUid, lastModifiedAt: Timestamp.now() };
}
