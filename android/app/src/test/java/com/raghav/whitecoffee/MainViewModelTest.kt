package com.raghav.whitecoffee

import com.raghav.whitecoffee.data.model.AccountStatus
import com.raghav.whitecoffee.data.model.isSessionSuperseded
import com.raghav.whitecoffee.domain.CloseOpenDayUseCase
import com.raghav.whitecoffee.fake.FakeAttendanceNotifier
import com.raghav.whitecoffee.fake.FakeAttendanceRepository
import com.raghav.whitecoffee.fake.FakeAuthRepository
import com.raghav.whitecoffee.fake.FakeLocationProvider
import com.raghav.whitecoffee.fake.FakeSessionManager
import com.raghav.whitecoffee.fake.FakeUserRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * App-root session enforcement (decision #34a).
 *
 * This ViewModel decides when to eject a signed-in user. Getting it wrong in one direction
 * signs people out of a working session; in the other it leaves a shared login active on a
 * device that should have lost it. Neither was testable while the Firestore listener was built
 * inline — the constructor demanded a live `FirebaseFirestore`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MainViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    private lateinit var session: FakeSessionManager
    private lateinit var auth: FakeAuthRepository
    private lateinit var users: FakeUserRepository
    private lateinit var attendance: FakeAttendanceRepository
    private lateinit var location: FakeLocationProvider
    private lateinit var notifier: FakeAttendanceNotifier

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        session = FakeSessionManager(sessionToken = "token-1")
        auth = FakeAuthRepository()
        users = FakeUserRepository()
        attendance = FakeAttendanceRepository()
        location = FakeLocationProvider()
        notifier = FakeAttendanceNotifier()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun viewModel() = MainViewModel(
        sessionManager = session,
        authRepository = auth,
        userRepository = users,
        closeOpenDay = CloseOpenDayUseCase(attendance, location, session),
        attendanceNotifier = notifier,
    )

    // ── The session-supersede decision, in isolation ──────────────────────

    @Test
    fun `a different non-empty server token supersedes this session`() {
        assertTrue(isSessionSuperseded(serverToken = "token-2", localToken = "token-1"))
    }

    @Test
    fun `the same token does not supersede`() {
        assertFalse(isSessionSuperseded(serverToken = "token-1", localToken = "token-1"))
    }

    @Test
    fun `an empty server token never supersedes`() {
        // A user doc predating the token field must not eject its owner on every snapshot.
        assertFalse(isSessionSuperseded(serverToken = "", localToken = "token-1"))
    }

    // ── The monitor wired end to end ──────────────────────────────────────

    @Test
    fun `monitor emits sessionInvalidated when another device takes the account`() = runTest(dispatcher) {
        val vm = viewModel()
        var invalidated = false
        val collector = launch { vm.sessionInvalidated.first(); invalidated = true }

        vm.startMonitorIfLoggedIn()
        advanceUntilIdle()
        users.emitActive(token = "token-2")
        advanceUntilIdle()

        assertTrue("expected ejection when the server token differs", invalidated)
        collector.cancel()
    }

    @Test
    fun `monitor stays quiet while the server token matches`() = runTest(dispatcher) {
        val vm = viewModel()
        var invalidated = false
        val collector = launch { vm.sessionInvalidated.first(); invalidated = true }

        vm.startMonitorIfLoggedIn()
        advanceUntilIdle()
        users.emitActive(token = "token-1")
        advanceUntilIdle()

        assertFalse("a matching token must never sign anyone out", invalidated)
        collector.cancel()
    }

    @Test
    fun `suspension from the server reaches accountStatus`() = runTest(dispatcher) {
        val vm = viewModel()
        vm.startMonitorIfLoggedIn()
        advanceUntilIdle()

        users.emitSuspended(reason = "Under review", expectedReturn = "2026-08-01", token = "token-1")
        advanceUntilIdle()

        val status = vm.accountStatus.value
        assertTrue(status is AccountStatus.Suspended)
        assertEquals("Under review", (status as AccountStatus.Suspended).reason)
    }

    @Test
    fun `monitor does not stack duplicate listeners`() = runTest(dispatcher) {
        val vm = viewModel()

        vm.startMonitorIfLoggedIn()
        vm.startMonitorIfLoggedIn()
        vm.onLoginSuccess()
        advanceUntilIdle()

        // MainActivity calls startMonitorIfLoggedIn() on every start; without the guard each
        // one would attach another listener to the same document.
        assertEquals(listOf("u1"), users.observedUserIds)
    }

    @Test
    fun `monitor does not start without a cached session token`() = runTest(dispatcher) {
        session.sessionToken = ""
        val vm = viewModel()

        vm.startMonitorIfLoggedIn()
        advanceUntilIdle()

        assertTrue(users.observedUserIds.isEmpty())
    }

    @Test
    fun `monitor does not start when signed out`() = runTest(dispatcher) {
        auth.loggedIn = false
        val vm = viewModel()

        vm.startMonitorIfLoggedIn()
        advanceUntilIdle()

        assertTrue(users.observedUserIds.isEmpty())
    }

    @Test
    fun `logout stops the monitor and resets the overlay`() = runTest(dispatcher) {
        val vm = viewModel()
        vm.startMonitorIfLoggedIn()
        advanceUntilIdle()
        users.emitSuspended(reason = "Under review", token = "token-1")
        advanceUntilIdle()
        assertTrue(vm.accountStatus.value is AccountStatus.Suspended)

        vm.logout()
        advanceUntilIdle()

        assertEquals(AccountStatus.Active, vm.accountStatus.value)
        assertEquals(1, auth.logoutCount)

        // A signed-out user has no read access to that document; the listener must be gone.
        users.emitSuspended(reason = "Should not arrive", token = "token-1")
        advanceUntilIdle()
        assertEquals(AccountStatus.Active, vm.accountStatus.value)
    }

    /**
     * Logging out closes the day (auto-checkout writes a terminal HOME_OUT), and neither
     * attendance ViewModel is alive to see it. An ongoing notification is undismissable, so a
     * missed clear leaves a signed-out phone permanently claiming someone is checked in.
     */
    @Test
    fun `logout clears the ongoing checked-in reminder`() = runTest(dispatcher) {
        val vm = viewModel()

        vm.logout()
        advanceUntilIdle()

        assertEquals(1, notifier.clearCount)
    }
}
