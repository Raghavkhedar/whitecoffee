package com.raghav.whitecoffee.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.raghav.whitecoffee.data.model.AppNotification
import com.raghav.whitecoffee.data.session.SessionManager
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

    suspend fun getNotifications(): Result<List<AppNotification>> {
        return try {
            val snapshot = collection()
                .orderBy("createdAt", Query.Direction.DESCENDING)
                .get()
                .await()
            Result.success(snapshot.documents.mapNotNull { AppNotification.fromDocument(it) })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getUnreadCount(): Result<Int> {
        return try {
            val snapshot = collection()
                .whereEqualTo("isRead", false)
                .get()
                .await()
            Result.success(snapshot.size())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun markAsRead(notifId: String): Result<Unit> {
        return try {
            collection().document(notifId).update("isRead", true).await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

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
            collection().add(notification.toMap()).await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

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
