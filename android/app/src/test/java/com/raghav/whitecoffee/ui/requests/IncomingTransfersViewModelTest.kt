package com.raghav.whitecoffee.ui.requests

import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.IncomingTransfer
import com.raghav.whitecoffee.data.model.Transfer
import com.raghav.whitecoffee.fake.FakeNetworkMonitor
import com.raghav.whitecoffee.fake.FakeRequestRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.launchIn
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

@OptIn(ExperimentalCoroutinesApi::class)
class IncomingTransfersViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private val repo = FakeRequestRepository()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    private fun incoming(id: String, status: String) = IncomingTransfer(
        "tool_transfers", Transfer(id = id, userId = "s1", receiverId = "u1", receiptStatus = status),
    )

    @Test
    fun `only transfers still open are listed`() = runTest(dispatcher) {
        repo.incoming.value = Result.success(
            listOf(incoming("a", "pending"), incoming("b", "received"), incoming("c", "problem")),
        )
        val vm = IncomingTransfersViewModel(repo, FakeNetworkMonitor())
        vm.state.launchIn(backgroundScope)
        advanceUntilIdle()

        val shown = (vm.state.value as UiState.Success).data.map { it.transfer.id }
        assertEquals(listOf("a", "c"), shown)
    }

    @Test
    fun `nothing open is the empty state`() = runTest(dispatcher) {
        repo.incoming.value = Result.success(listOf(incoming("b", "received")))
        val vm = IncomingTransfersViewModel(repo, FakeNetworkMonitor())
        vm.state.launchIn(backgroundScope)
        advanceUntilIdle()

        assertTrue(vm.state.value is UiState.Empty)
    }

    @Test
    fun `confirm and problem are written against the sender's document`() = runTest(dispatcher) {
        val vm = IncomingTransfersViewModel(repo, FakeNetworkMonitor())

        vm.confirm(incoming("a", "pending"))
        vm.reportProblem(incoming("c", "pending"), "  one missing  ")
        advanceUntilIdle()

        assertEquals(
            listOf(
                listOf("tool_transfers", "s1", "a", "received", ""),
                listOf("tool_transfers", "s1", "c", "problem", "one missing"),
            ),
            repo.receipts,
        )
    }

    @Test
    fun `a problem without a note writes nothing`() = runTest(dispatcher) {
        val vm = IncomingTransfersViewModel(repo, FakeNetworkMonitor())

        vm.reportProblem(incoming("a", "pending"), "   ")
        advanceUntilIdle()

        assertTrue(repo.receipts.isEmpty())
    }
}
