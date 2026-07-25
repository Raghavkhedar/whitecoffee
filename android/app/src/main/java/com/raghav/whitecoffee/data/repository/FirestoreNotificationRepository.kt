package com.raghav.whitecoffee.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.raghav.whitecoffee.data.firestore.AuditStamp
import com.raghav.whitecoffee.data.firestore.snapshotsAsFlow
import com.raghav.whitecoffee.data.firestore.withAuditStamp
import com.raghav.whitecoffee.data.model.AppNotification
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class NotificationRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) {

    private fun collection() = firestore
        .collection("users")
        .document(sessionManager.userId)
        .collection("notifications")

    fun observeNotifications(): Flow<List<AppNotification>> =
        collection()
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(50)
            .snapshotsAsFlow()
            .map { snap -> snap.documents.mapNotNull { AppNotification.fromDocument(it) } }

    fun observeUnreadCount(): Flow<Int> =
        collection()
            .whereEqualTo("isRead", false)
            .snapshotsAsFlow()
            .map { it.size() }

    /**
     * ⚠️ AUDIT-EXEMPT — no lastModifiedBy/lastModifiedAt.
     * firestore.rules lets the owner update their own notification only when
     * changedKeysWithin(['isRead']) holds (hasOnly), so a third key would be denied and the
     * bell badge would never clear. The doc is owner-scoped, so the path already names the actor.
     */
    suspend fun markAsRead(notifId: String): Result<Unit> {
        return try {
            collection().document(notifId).update("isRead", true).await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** ⚠️ AUDIT-EXEMPT for the same reason as [markAsRead] — changedKeysWithin(['isRead']). */
    suspend fun markAllAsRead(): Result<Unit> {
        return try {
            val batch = firestore.batch()
            val unread = collection().whereEqualTo("isRead", false).get().await()
            unread.documents.forEach { batch.update(it.reference, "isRead", true) }
            batch.commit().await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun saveNotification(notification: AppNotification): Result<Unit> {
        return try {
            if (sessionManager.userId.isEmpty()) return Result.success(Unit)
            // Stampable: the notification CREATE rule is a plain allow (no hasOnly).
            collection().add(notification.toMap().withAuditStamp(AuditStamp.uid(sessionManager)))
                .await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * ⚠️ AUDIT-EXEMPT — no lastModifiedBy/lastModifiedAt.
     * Same user-doc rule as the login session-token write: a non-admin owner may update only
     * changedKeysWithin(['activeSessionToken', 'fcmToken']) (hasOnly). A third key would be
     * denied and the device would stop receiving push notifications.
     */
    suspend fun saveToken(token: String): Result<Unit> {
        return try {
            if (sessionManager.userId.isEmpty()) return Result.success(Unit)
            firestore.collection("users")
                .document(sessionManager.userId)
                .update("fcmToken", token)
                .await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
