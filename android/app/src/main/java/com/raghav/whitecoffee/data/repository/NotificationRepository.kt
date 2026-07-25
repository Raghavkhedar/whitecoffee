package com.raghav.whitecoffee.data.repository

import com.raghav.whitecoffee.data.model.AppNotification
import kotlinx.coroutines.flow.Flow

/**
 * In-app notification inbox and the device's FCM token.
 *
 * Implemented by [FirestoreNotificationRepository] in production, faked in tests.
 */
interface NotificationRepository {

    fun observeNotifications(): Flow<List<AppNotification>>

    /** Live unread count — drives the bell badge. */
    fun observeUnreadCount(): Flow<Int>

    suspend fun markAsRead(notifId: String): Result<Unit>

    suspend fun markAllAsRead(): Result<Unit>

    /** Persists a notification received while the app was foregrounded. */
    suspend fun saveNotification(notification: AppNotification): Result<Unit>

    /** Stores the device's FCM token on the user document. */
    suspend fun saveToken(token: String): Result<Unit>
}
