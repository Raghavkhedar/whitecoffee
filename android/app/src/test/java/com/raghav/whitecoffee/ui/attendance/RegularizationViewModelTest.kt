package com.raghav.whitecoffee.ui.attendance

import com.google.firebase.Timestamp
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.RegularizationRequest
import com.raghav.whitecoffee.data.session.SessionManager
import com.raghav.whitecoffee.fake.FakeAttendanceRepository
import com.raghav.whitecoffee.fake.FakeClock
import com.raghav.whitecoffee.fake.FakeNetworkMonitor
import com.raghav.whitecoffee.fake.FakeRegularizationRepository
import com.raghav.whitecoffee.fake.FakeSessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
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
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Calendar

/**
 * Today's regularization preview — the screen that tells an employee whether *today* is worth
 * filing a regularization request for, and carries any request already on file for it.
 *
 * The event source and window per role come from [com.raghav.whitecoffee.data.model.RoleCapabilities]
 * / [com.raghav.whitecoffee.data.model.AttendanceStatusRules] — the sales test below exists
 * because a hand-written `office_in`-only filter would make a sales SITE day invisible here,
 * which is exactly the isOperations-binary bug this app has shipped twice before.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RegularizationViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    private lateinit var repo: FakeRegularizationRepository
    private lateinit var attendance: FakeAttendanceRepository

    private val today: String = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repo = FakeRegularizationRepository()
        attendance = FakeAttendanceRepository()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    // The clock is pinned to the real current date, not FakeClock's default, because these
    // tests build their events with Calendar.getInstance() — i.e. actually today. A fixed
    // fake date would make the filed `date` disagree with the events it was derived from,
    // which is the very bug the seam exists to prevent.
    private fun subject(
        session: FakeSessionManager = FakeSessionManager(),
        network: FakeNetworkMonitor = FakeNetworkMonitor(),
        clock: FakeClock = FakeClock(java.time.LocalDate.now().toString()),
    ) = RegularizationViewModel(repo, attendance, session, network, clock)

    /** An event at local [hour]:[minute] today. */
    private fun at(hour: Int, minute: Int, type: String, siteName: String = ""): AttendanceRecord {
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }
        return AttendanceRecord(id = "e", userId = "u1", type = type, timestamp = Timestamp(cal.time), siteName = siteName)
    }

    private fun singleItem(vm: RegularizationViewModel): RegularizationDayItem {
        val state = vm.daysState.value
        assertTrue(state is UiState.Success)
        return (state as UiState.Success).data.single()
    }

    // ── nothing to fix ───────────────────────────────────────────────────

    @Test
    fun `an empty day has nothing to regularize`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        assertTrue(vm.daysState.value is UiState.Empty)
    }

    @Test
    fun `an on-time office day has nothing to regularize`() = runTest(dispatcher) {
        attendance = FakeAttendanceRepository(
            listOf(at(10, 0, AttendanceType.OFFICE_IN), at(18, 0, AttendanceType.OFFICE_OUT))
        )
        val vm = subject(session = FakeSessionManager(role = SessionManager.ROLE_OFFICE))
        advanceUntilIdle()

        assertTrue(vm.daysState.value is UiState.Empty)
    }

    // ── day rollover — the filed date must follow the clock ──────────────

    @Test
    fun `the filed date follows the clock across midnight`() = runTest(dispatcher) {
        // The screen is left open overnight. `date` here is not a label: it is what
        // submitRequest() files against, and an admin approving a request rewrites THAT day's
        // attendance_status. Frozen at construction, an employee disputing today's status would
        // silently file against yesterday and get yesterday's pay rewritten instead.
        val clock = FakeClock("2026-08-07")
        attendance = FakeAttendanceRepository(listOf(at(13, 0, AttendanceType.OFFICE_IN)))
        val vm = subject(session = FakeSessionManager(role = SessionManager.ROLE_OFFICE), clock = clock)
        advanceUntilIdle()
        assertEquals("2026-08-07", singleItem(vm).date)

        clock.rollOver("2026-08-08")
        advanceUntilIdle()

        assertEquals("2026-08-08", singleItem(vm).date)
    }

    @Test
    fun `the header label follows the clock across midnight`() = runTest(dispatcher) {
        val clock = FakeClock("2026-08-07")
        val vm = subject(clock = clock)
        val collect = launch { vm.todayLabel.collect { } }   // stateIn is WhileSubscribed
        advanceUntilIdle()
        assertTrue(vm.todayLabel.value.startsWith("7 Aug 2026"))

        clock.rollOver("2026-08-08")
        advanceUntilIdle()

        assertTrue(vm.todayLabel.value.startsWith("8 Aug 2026"))
        collect.cancel()
    }

    // ── regularizable statuses ───────────────────────────────────────────

    @Test
    fun `an office day scored Half Day surfaces as a regularizable item`() = runTest(dispatcher) {
        attendance = FakeAttendanceRepository(listOf(at(13, 0, AttendanceType.OFFICE_IN)))
        val vm = subject(session = FakeSessionManager(role = SessionManager.ROLE_OFFICE))
        advanceUntilIdle()

        val item = singleItem(vm)
        assertEquals(today, item.date)
        assertEquals("HalfDay", item.originalStatus)
        assertEquals(null, item.request)
    }

    @Test
    fun `an office day scored Short Leave surfaces as SL`() = runTest(dispatcher) {
        // On-time check-in, early check-out only (no late-in) -> SL under the zero-grace rule.
        // An in-progress day (no checkout) can no longer produce SL at all, since any late-in
        // forces Half Day and early-out can't be known without a completed checkout.
        attendance = FakeAttendanceRepository(
            listOf(at(10, 0, AttendanceType.OFFICE_IN), at(17, 30, AttendanceType.OFFICE_OUT))
        )
        val vm = subject(session = FakeSessionManager(role = SessionManager.ROLE_OFFICE))
        advanceUntilIdle()

        assertEquals("SL", singleItem(vm).originalStatus)
    }

    /**
     * The concern this test exists for: the sales column of RoleCapabilities is what makes a
     * SITE-visit day (rather than an office day) visible here at all. A hand-written filter that
     * only knew about `office_in`/`office_out` would silently drop this day.
     */
    @Test
    fun `a sales site-visit day is regularizable, not invisible`() = runTest(dispatcher) {
        attendance = FakeAttendanceRepository(
            listOf(at(13, 0, AttendanceType.SITE_IN, siteName = "Client Site"), at(18, 0, AttendanceType.SITE_OUT))
        )
        val vm = subject(session = FakeSessionManager(role = SessionManager.ROLE_SALES))
        advanceUntilIdle()

        assertEquals("HalfDay", singleItem(vm).originalStatus)
    }

    @Test
    fun `operations scored against its planned shift surfaces correctly`() = runTest(dispatcher) {
        attendance = FakeAttendanceRepository(listOf(at(9, 0, AttendanceType.SITE_IN)))
        attendance.plannedWindow = 8 * 60 to 16 * 60
        val vm = subject(session = FakeSessionManager(role = SessionManager.ROLE_OPERATIONS))
        advanceUntilIdle()

        // 1 hour late, day still open (no out) -> any late-in is zero-grace Half Day.
        assertEquals("HalfDay", singleItem(vm).originalStatus)
    }

    /**
     * A worked operations day with no admin-set shift must still be regularizable.
     *
     * Payroll's `shouldEvaluateDay` scores any ops day that has a plan OR approved leave OR real
     * work events, falling back to 10:00–18:00 when the plan is missing, and the home screen
     * mirrors that via ResolveTodayStatusUseCase. This screen used to return "nothing to
     * regularize" for the same day, so an employee saw Half Day on the home screen and had no way
     * to dispute it. Checking in at 13:00 is any-amount late against the default window — zero
     * grace, so Half Day.
     */
    @Test
    fun `an operations day worked with no planned shift is still regularizable`() =
        runTest(dispatcher) {
            attendance = FakeAttendanceRepository(
                listOf(at(13, 0, AttendanceType.SITE_IN), at(18, 0, AttendanceType.SITE_OUT))
            )
            // plannedWindow deliberately left null - no admin-set shift.
            val vm = subject(session = FakeSessionManager(role = SessionManager.ROLE_OPERATIONS))
            advanceUntilIdle()

            val state = vm.daysState.value
            assertTrue("a worked ops day must be disputable", state is UiState.Success)
            assertEquals("HalfDay", (state as UiState.Success).data.single().originalStatus)
        }

    // ── an existing request is attached ─────────────────────────────────

    @Test
    fun `an existing request for today is attached to the item`() = runTest(dispatcher) {
        attendance = FakeAttendanceRepository(listOf(at(13, 0, AttendanceType.OFFICE_IN)))
        val existing = RegularizationRequest(
            id = "r1", date = today, originalStatus = "HalfDay", reason = "Doctor visit", status = "pending"
        )
        repo.setRequestForDate(today, existing)
        val vm = subject(session = FakeSessionManager(role = SessionManager.ROLE_OFFICE))
        advanceUntilIdle()

        assertEquals(existing, singleItem(vm).request)
    }

    // ── submit ───────────────────────────────────────────────────────────

    @Test
    fun `submitRequest writes through the repository`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.submitRequest(today, "HalfDay", "Doctor visit")
        advanceUntilIdle()

        assertEquals(1, repo.submitted.size)
        assertEquals("Doctor visit", repo.submitted.single().reason)
        assertTrue(vm.submitState.value is UiState.Success)
    }

    @Test
    fun `a duplicate request for the same date is refused`() = runTest(dispatcher) {
        repo.setRequestForDate(
            today, RegularizationRequest(id = "r1", date = today, status = "pending")
        )
        val vm = subject()
        advanceUntilIdle()

        vm.submitRequest(today, "HalfDay", "Doctor visit")
        advanceUntilIdle()

        assertTrue(vm.submitState.value is UiState.Error)
        assertTrue(repo.submitted.isEmpty())
    }

    @Test
    fun `resetSubmitState clears a previous result`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.submitRequest(today, "HalfDay", "")
        advanceUntilIdle()
        assertTrue(vm.submitState.value is UiState.Error)

        vm.resetSubmitState()

        assertTrue(vm.submitState.value is UiState.Empty)
    }
}
