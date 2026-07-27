package com.raghav.whitecoffee.ui.attendance

import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.fake.FakeLeaveRepository
import com.raghav.whitecoffee.fake.FakeNetworkMonitor
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
 * The employee's own leave history (as opposed to [LeaveApprovalsViewModel], the admin queue).
 *
 * Like the approvals screen, this must not gate its subscription on connectivity — Firestore's
 * persistent cache means an offline employee should still see the leave they applied for
 * yesterday, not a spinner or an empty screen.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LeaveViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    private lateinit var repo: FakeLeaveRepository

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repo = FakeLeaveRepository()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun request(id: String) = LeaveRequest(
        id = id,
        userId = "u1",
        userName = "Test User",
        fromDate = "2026-07-27",
        toDate = "2026-07-28",
        totalDays = 2,
        reason = "Family function",
    )

    private fun subject(online: Boolean = true) = LeaveViewModel(repo, FakeNetworkMonitor(online))

    @Test
    fun `the employee's own leave requests are listed`() = runTest(dispatcher) {
        repo.setPending(listOf(request("a"), request("b")))
        val vm = subject()
        advanceUntilIdle()

        val state = vm.leavesState.value
        assertTrue(state is UiState.Success)
        assertEquals(2, (state as UiState.Success).data.size)
    }

    @Test
    fun `no leave history yet is Empty, not Success with nothing in it`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        assertTrue(vm.leavesState.value is UiState.Empty)
    }

    /**
     * Firestore's persistent cache still holds yesterday's applied leave even without a network.
     * A ViewModel that checks connectivity before subscribing would show an empty screen over
     * data the SDK already has — the exact regression LeaveApprovalsViewModelTest exists for.
     */
    @Test
    fun `cached leave history still loads while offline`() = runTest(dispatcher) {
        repo.setPending(listOf(request("a")))
        val vm = subject(online = false)
        advanceUntilIdle()

        val state = vm.leavesState.value
        assertTrue("offline must not block the subscription", state is UiState.Success)
        assertEquals(1, (state as UiState.Success).data.size)
    }

    @Test
    fun `a stream failure surfaces a readable error, not a stuck spinner`() = runTest(dispatcher) {
        repo.flowFailWith = IllegalStateException("Firestore unavailable")
        val vm = subject()
        advanceUntilIdle()

        val state = vm.leavesState.value
        assertTrue(state is UiState.Error)
        assertEquals("Failed to load leave requests.", (state as UiState.Error).message)
    }

    @Test
    fun `loadLeaves can be re-invoked and reflects the latest data`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()
        assertTrue(vm.leavesState.value is UiState.Empty)

        repo.setPending(listOf(request("a")))
        vm.loadLeaves()
        advanceUntilIdle()

        val state = vm.leavesState.value
        assertTrue(state is UiState.Success)
        assertEquals(1, (state as UiState.Success).data.size)
    }
}
