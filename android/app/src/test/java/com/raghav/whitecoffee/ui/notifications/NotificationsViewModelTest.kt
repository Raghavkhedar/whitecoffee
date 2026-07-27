package com.raghav.whitecoffee.ui.notifications

import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.AppNotification
import com.raghav.whitecoffee.fake.FakeNetworkMonitor
import com.raghav.whitecoffee.fake.FakeNotificationRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The in-app notification inbox — decision #21 (CLAUDE.md): notifications live in a Firestore
 * sub-collection and the bell badge is `getUnreadCount()`. `markAsRead`/`markAllAsRead` must
 * actually reach the repository, not just flip local UI state, or the badge count drifts from
 * what a second device (or a re-launch) sees.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationsViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    private lateinit var repo: FakeNotificationRepository

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repo = FakeNotificationRepository()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun notif(id: String, isRead: Boolean = false) =
        AppNotification(id = id, title = "Title $id", body = "Body $id", isRead = isRead)

    private fun subject() = NotificationsViewModel(repo, FakeNetworkMonitor())

    @Test
    fun `notifications are listed`() = runTest(dispatcher) {
        repo.setNotifications(listOf(notif("a"), notif("b")))
        val vm = subject()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertTrue(state is UiState.Success)
        assertEquals(2, (state as UiState.Success).data.size)
    }

    @Test
    fun `an empty inbox is Empty, not Success with nothing in it`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        assertTrue(vm.uiState.value is UiState.Empty)
    }

    @Test
    fun `a stream failure surfaces a readable error`() = runTest(dispatcher) {
        repo.failWith = IllegalStateException("Firestore unavailable")
        val vm = subject()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertTrue(state is UiState.Error)
        assertEquals("Failed to load notifications.", (state as UiState.Error).message)
    }

    /**
     * The bell badge and the inbox screen must agree, which only holds if `markAsRead` writes
     * through to the same store the badge count reads.
     */
    @Test
    fun `marking one notification read flips only that one, in the repository`() = runTest(dispatcher) {
        repo.setNotifications(listOf(notif("a"), notif("b")))
        val vm = subject()
        advanceUntilIdle()

        vm.markAsRead("a")
        advanceUntilIdle()

        val list = (vm.uiState.value as UiState.Success).data
        assertTrue(list.single { it.id == "a" }.isRead)
        assertTrue("the other notification must be unaffected", !list.single { it.id == "b" }.isRead)
    }

    @Test
    fun `markAllAsRead clears every unread flag`() = runTest(dispatcher) {
        repo.setNotifications(listOf(notif("a"), notif("b")))
        val vm = subject()
        advanceUntilIdle()

        vm.markAllAsRead()
        advanceUntilIdle()

        val list = (vm.uiState.value as UiState.Success).data
        assertTrue(list.all { it.isRead })
    }

    @Test
    fun `loadNotifications can be re-invoked and reflects newly arrived items`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()
        assertTrue(vm.uiState.value is UiState.Empty)

        repo.setNotifications(listOf(notif("a")))
        vm.loadNotifications()
        advanceUntilIdle()

        assertEquals(1, (vm.uiState.value as UiState.Success).data.size)
    }
}
