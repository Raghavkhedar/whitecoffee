package com.raghav.whitecoffee.ui.attendance

import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.fake.FakeLeaveRepository
import com.raghav.whitecoffee.fake.FakeNetworkMonitor
import com.raghav.whitecoffee.fake.FakeSessionManager
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
 * Leave Approvals — the admin queue.
 *
 * The offline tests here are the point of the suite. Firestore is configured with a persistent
 * local cache, so an offline admin still has the requests they loaded earlier; a ViewModel that
 * checks connectivity and returns before subscribing throws that away and shows an empty screen
 * over data the SDK is holding. These lock that behaviour down so it cannot come back.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LeaveApprovalsViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    private lateinit var repo: FakeLeaveRepository

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repo = FakeLeaveRepository()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun request(id: String, name: String = "Asha") = LeaveRequest(
        id = id,
        userId = "u-$id",
        userName = name,
        fromDate = "2026-07-27",
        toDate = "2026-07-28",
        totalDays = 2,
        reason = "Family function",
    )

    private fun subject(online: Boolean = true) = LeaveApprovalsViewModel(
        repo, FakeSessionManager(), FakeNetworkMonitor(online)
    )

    @Test
    fun `pending requests are listed`() = runTest(dispatcher) {
        repo.setPending(listOf(request("a"), request("b")))
        val vm = subject()
        advanceUntilIdle()

        val state = vm.approvalsState.value
        assertTrue(state is UiState.Success)
        assertEquals(2, (state as UiState.Success).data.size)
    }

    /**
     * The regression this task exists to prevent. The old `isOnline.first()` pre-flight returned
     * before subscribing, so an offline admin saw an empty offline screen instead of the cached
     * queue. Connectivity must not gate the subscription.
     */
    @Test
    fun `cached requests still load while offline`() = runTest(dispatcher) {
        repo.setPending(listOf(request("a")))
        val vm = subject(online = false)
        advanceUntilIdle()

        val state = vm.approvalsState.value
        assertTrue("offline must not block the subscription", state is UiState.Success)
        assertEquals(1, (state as UiState.Success).data.size)
    }

    @Test
    fun `an empty queue is Empty, not Success with nothing in it`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        assertTrue(vm.approvalsState.value is UiState.Empty)
    }

    @Test
    fun `approving removes the request from the queue`() = runTest(dispatcher) {
        repo.setPending(listOf(request("a"), request("b")))
        val vm = subject()
        advanceUntilIdle()

        vm.approve(request("a"))
        advanceUntilIdle()

        assertEquals(listOf("a"), repo.approved)
        val state = vm.approvalsState.value
        assertEquals(1, (state as UiState.Success).data.size)
    }

    @Test
    fun `rejecting carries the approver comment`() = runTest(dispatcher) {
        repo.setPending(listOf(request("a")))
        val vm = subject()
        advanceUntilIdle()

        vm.reject(request("a"), "  Insufficient notice  ")
        advanceUntilIdle()

        assertEquals(listOf("a" to "Insufficient notice"), repo.rejected)
    }

    @Test
    fun `a failed approval surfaces the reason and leaves the queue alone`() = runTest(dispatcher) {
        repo.setPending(listOf(request("a")))
        val vm = subject()
        advanceUntilIdle()

        repo.failWith = IllegalStateException("permission denied")
        vm.approve(request("a"))
        advanceUntilIdle()

        val action = vm.actionState.value
        assertTrue(action is UiState.Error)
        assertEquals("permission denied", (action as UiState.Error).message)
        assertEquals(1, (vm.approvalsState.value as UiState.Success).data.size)
    }
}
