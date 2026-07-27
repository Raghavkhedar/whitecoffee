package com.raghav.whitecoffee.fake

import com.raghav.whitecoffee.data.model.AppNotification
import com.raghav.whitecoffee.data.repository.NotificationRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

/**
 * In-memory [NotificationRepository] for unit tests.
 *
 * A fake, not a mock: [observeUnreadCount] is actually derived from the same list
 * [observeNotifications] streams — it counts `!isRead` entries rather than returning a scripted
 * number — and marking a notification read actually flips its `isRead` flag in that list. A test
 * that asserts on the bell-badge count is exercising real arithmetic over shared state, not the
 * test's own stubbing.
 */
class FakeNotificationRepository(
    initialNotifications: List<AppNotification> = emptyList()
) : NotificationRepository {

    private val notifications = MutableStateFlow(initialNotifications)

    /** When set, every suspending call fails with this error, and both flows emit it. */
    var failWith: Exception? = null

    /** The most recent FCM token handed to [saveToken]. */
    var savedToken: String? = null
        private set

    /** Every notification passed to [saveNotification], in order. */
    val saved = mutableListOf<AppNotification>()

    fun setNotifications(list: List<AppNotification>) { notifications.value = list }

    private fun stream(): Flow<List<AppNotification>> = notifications.map { list ->
        failWith?.let { throw it }
        list
    }

    override fun observeNotifications(): Flow<List<AppNotification>> = stream()

    override fun observeUnreadCount(): Flow<Int> = stream().map { list -> list.count { !it.isRead } }

    override suspend fun markAsRead(notifId: String): Result<Unit> {
        failWith?.let { return Result.failure(it) }
        notifications.value = notifications.value.map {
            if (it.id == notifId) it.copy(isRead = true) else it
        }
        return Result.success(Unit)
    }

    override suspend fun markAllAsRead(): Result<Unit> {
        failWith?.let { return Result.failure(it) }
        notifications.value = notifications.value.map { it.copy(isRead = true) }
        return Result.success(Unit)
    }

    override suspend fun saveNotification(notification: AppNotification): Result<Unit> {
        failWith?.let { return Result.failure(it) }
        saved += notification
        notifications.value = notifications.value + notification
        return Result.success(Unit)
    }

    override suspend fun saveToken(token: String): Result<Unit> {
        failWith?.let { return Result.failure(it) }
        savedToken = token
        return Result.success(Unit)
    }
}
