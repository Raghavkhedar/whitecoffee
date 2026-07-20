package com.raghav.whitecoffee.data.firestore

import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.raghav.whitecoffee.data.session.SessionManager

/**
 * Actor stamp for every Firestore write made by the app.
 *
 * WHY: the audit log (`firebase/functions/auditLog.js`) is a Firestore *trigger*, and triggers
 * carry NO auth context — the trigger sees the document, never the identity that wrote it.
 * The only way an audit entry can name a writer is if the document itself records one, so every
 * client write stamps `lastModifiedBy` (the acting auth uid) + `lastModifiedAt`.
 * `lastModifiedBy` is the FIRST entry in `auditLog.js`'s ACTOR_FIELDS and is authoritative there.
 *
 * ⚠️ NOT EVERY WRITE MAY BE STAMPED. `firebase/firestore.rules` pins several owner-writes to an
 * exact field set via `changedKeysWithin([...])` (which is `affectedKeys().hasOnly(...)`). Adding
 * a field to one of those payloads makes the whole write DENIED. The exempt payloads are:
 *   · users/{uid}                       → owner may change ONLY activeSessionToken / fcmToken
 *   · users/{uid}/notifications/{id}    → owner may change ONLY isRead
 *   · submissions (material_requests, material_purchases, material_transfers, tool_transfers,
 *     work_progress) owner-side photoUrls patch → owner may change ONLY photoUrls
 * Each such call site carries an "AUDIT-EXEMPT" comment. Do not stamp them unless the matching
 * rule is widened first — a denied write here breaks login, notifications, or photo upload.
 */
object AuditStamp {

    const val FIELD_BY = "lastModifiedBy"
    const val FIELD_AT = "lastModifiedAt"

    /**
     * The acting auth uid. FirebaseAuth is the authority (it is what security rules compare
     * `request.auth.uid` against); the cached [SessionManager.userId] — populated at login from
     * `firebaseUser.uid`, so it is the same value — is the fallback for the window where the
     * profile has been restored from prefs but auth has not yet re-materialised.
     */
    fun uid(sessionManager: SessionManager, auth: FirebaseAuth? = null): String =
        auth?.currentUser?.uid?.takeIf { it.isNotEmpty() } ?: sessionManager.userId

    /** The two audit fields on their own, for callers that build a payload by hand. */
    fun fields(uid: String): Map<String, Any?> = mapOf(
        FIELD_BY to uid,
        FIELD_AT to Timestamp.now()
    )
}

/**
 * Returns a copy of this write payload with the audit fields merged in. ADDITIVE ONLY —
 * no existing key is removed, renamed or reordered (`Map` plus keeps every left-hand entry, and
 * neither audit key is used by any model).
 *
 * `Map<K, out V>` is covariant in Kotlin, so this also accepts the `Map<String, Any>` payloads
 * produced by the line-item models.
 */
fun Map<String, Any?>.withAuditStamp(uid: String): Map<String, Any?> =
    this + AuditStamp.fields(uid)
