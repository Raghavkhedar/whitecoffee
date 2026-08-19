package com.raghav.whitecoffee.ui.home

import com.google.firebase.Timestamp
import com.raghav.whitecoffee.data.model.AppNotification
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.session.SessionManager
import com.raghav.whitecoffee.domain.ResolveTodayStatusUseCase
import com.raghav.whitecoffee.fake.FakeAttendanceRepository
import com.raghav.whitecoffee.fake.FakeNetworkMonitor
import com.raghav.whitecoffee.fake.FakeNotificationRepository
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.Calendar

/**
 * The home screen's today-status card and logout-warning gate.
 *
 * [ResolveTodayStatusUseCase] itself is already unit-tested; what matters here is that
 * `HomeViewModel` feeds it the right events/window and turns the verdict into the right on-screen
 * location text — and that `logoutWouldEndDay` (which drives the destructive-logout confirmation)
 * is derived from the same emission as the status, never a stale one. The sales case is included
 * because this app has twice shipped a payroll bug from treating sales as plain office/operations.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() { Dispatchers.setMain(dispatcher) }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun subject(
        session: FakeSessionManager = FakeSessionManager(),
        attendance: FakeAttendanceRepository = FakeAttendanceRepository(),
        notifications: FakeNotificationRepository = FakeNotificationRepository(),
        network: FakeNetworkMonitor = FakeNetworkMonitor(),
    ) = HomeViewModel(
        session, notifications, attendance,
        ResolveTodayStatusUseCase(session), network
    )

    /** An event at local [hour]:[minute] — the same clock the scoring window is expressed in. */
    private fun at(
        hour: Int, minute: Int, type: String,
        siteName: String = "", marketName: String = "", locationName: String = "",
    ): AttendanceRecord {
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }
        return AttendanceRecord(
            id = "e", userId = "u1", type = type, timestamp = Timestamp(cal.time),
            siteName = siteName, marketName = marketName, locationName = locationName,
        )
    }

    private fun notif(id: String, isRead: Boolean) =
        AppNotification(id = id, title = "t", body = "b", isRead = isRead)

    // ── today's status ──────────────────────────────────────────────────

    @Test
    fun `with no attendance events today, status is Not Checked In`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        assertEquals(TodayAttendanceStatus.NotCheckedIn, vm.uiState.value.todayStatus)
    }

    @Test
    fun `an on-time full office day is scored Present with the closing location`() =
        runTest(dispatcher) {
            val session = FakeSessionManager(role = SessionManager.ROLE_OFFICE)
            val attendance = FakeAttendanceRepository(
                listOf(at(10, 0, AttendanceType.OFFICE_IN), at(18, 0, AttendanceType.OFFICE_OUT))
            )
            val vm = subject(session = session, attendance = attendance)
            advanceUntilIdle()

            val status = vm.uiState.value.todayStatus
            assertTrue(status is TodayAttendanceStatus.Present)
            assertEquals("Left office", (status as TodayAttendanceStatus.Present).location)
        }

    /**
     * Matches payroll's zero-grace rule (CLAUDE.md): any late-in at all is Half Day, however
     * small — the boundary that the old hour-granular check used to get wrong (it scored the
     * whole 10:00 hour as Half Day; this asserts a genuinely late arrival still grades correctly).
     */
    @Test
    fun `an office day two hours late is Half Day`() = runTest(dispatcher) {
        val session = FakeSessionManager(role = SessionManager.ROLE_OFFICE)
        val attendance = FakeAttendanceRepository(listOf(at(12, 0, AttendanceType.OFFICE_IN)))
        val vm = subject(session = session, attendance = attendance)
        advanceUntilIdle()

        val status = vm.uiState.value.todayStatus
        assertTrue(status is TodayAttendanceStatus.HalfDay)
        assertEquals("In Office", (status as TodayAttendanceStatus.HalfDay).location)
    }

    @Test
    fun `an office day more than two hours off is Half Day`() = runTest(dispatcher) {
        val session = FakeSessionManager(role = SessionManager.ROLE_OFFICE)
        val attendance = FakeAttendanceRepository(listOf(at(13, 0, AttendanceType.OFFICE_IN)))
        val vm = subject(session = session, attendance = attendance)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.todayStatus is TodayAttendanceStatus.HalfDay)
    }

    /**
     * Operations days are scheduled, not defaulted to absent — before the first site/market
     * arrival the day genuinely has no verdict yet.
     */
    @Test
    fun `operations before reaching any site shows Pending, not an absence`() = runTest(dispatcher) {
        val session = FakeSessionManager(role = SessionManager.ROLE_OPERATIONS)
        val attendance = FakeAttendanceRepository(listOf(at(8, 0, AttendanceType.HOME_IN)))
        val vm = subject(session = session, attendance = attendance)
        advanceUntilIdle()

        val status = vm.uiState.value.todayStatus
        assertTrue(status is TodayAttendanceStatus.Pending)
        assertEquals("At Home", (status as TodayAttendanceStatus.Pending).location)
    }

    @Test
    fun `operations scored against the planned shift shows the site as the location`() =
        runTest(dispatcher) {
            val session = FakeSessionManager(role = SessionManager.ROLE_OPERATIONS)
            val attendance = FakeAttendanceRepository(
                listOf(at(8, 0, AttendanceType.SITE_IN, siteName = "Gurugaon Site"))
            )
            attendance.plannedWindow = 8 * 60 to 16 * 60
            val vm = subject(session = session, attendance = attendance)
            advanceUntilIdle()

            val status = vm.uiState.value.todayStatus
            assertTrue(status is TodayAttendanceStatus.Present)
            assertEquals("At Gurugaon Site", (status as TodayAttendanceStatus.Present).location)
        }

    @Test
    fun `a market check-in with no market name given shows a generic label`() = runTest(dispatcher) {
        val session = FakeSessionManager(role = SessionManager.ROLE_OPERATIONS)
        val attendance = FakeAttendanceRepository(
            listOf(at(8, 0, AttendanceType.HOME_IN), at(9, 0, AttendanceType.MARKET_IN))
        )
        val vm = subject(session = session, attendance = attendance)
        advanceUntilIdle()

        val status = vm.uiState.value.todayStatus
        assertTrue(status is TodayAttendanceStatus.Present)
        assertEquals("At Market", (status as TodayAttendanceStatus.Present).location)
    }

    /**
     * Sales rides neither the office nor the operations branch (CLAUDE.md — two real payroll
     * bugs came from exactly this binary). A mixed office-leg-then-site-leg day must still be
     * scored, using the union of both event sets and the fixed window.
     */
    @Test
    fun `sales mixing an office leg and a site leg is still scored, not treated as an absence`() =
        runTest(dispatcher) {
            val session = FakeSessionManager(role = SessionManager.ROLE_SALES)
            val attendance = FakeAttendanceRepository(
                listOf(
                    at(10, 0, AttendanceType.OFFICE_IN),
                    at(12, 0, AttendanceType.OFFICE_OUT),
                    at(13, 0, AttendanceType.SITE_IN, siteName = "Client Site"),
                    at(18, 0, AttendanceType.SITE_OUT),
                )
            )
            val vm = subject(session = session, attendance = attendance)
            advanceUntilIdle()

            assertTrue(vm.uiState.value.todayStatus is TodayAttendanceStatus.Present)
        }

    @Test
    fun `a stream failure surfaces as Error, not a stale Loading spinner`() = runTest(dispatcher) {
        val attendance = FakeAttendanceRepository()
        attendance.flowFailWith = IllegalStateException("offline")
        val vm = subject(attendance = attendance)
        advanceUntilIdle()

        assertEquals(TodayAttendanceStatus.Error, vm.uiState.value.todayStatus)
    }

    // ── unread notification count ───────────────────────────────────────

    @Test
    fun `unread notification count flows onto the home state`() = runTest(dispatcher) {
        val notifications = FakeNotificationRepository(
            listOf(notif("n1", isRead = false), notif("n2", isRead = false), notif("n3", isRead = true))
        )
        val vm = subject(notifications = notifications)
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.unreadCount)
    }

    // ── logoutWouldEndDay — must never drift from the status it accompanies ──

    /**
     * `logoutWouldEndDay` gates the destructive logout confirmation. It must be true whenever an
     * accidental logout would auto-write a terminal HOME_OUT — here, mid-site.
     */
    @Test
    fun `logout would end the day while checked in at a site`() = runTest(dispatcher) {
        val session = FakeSessionManager(role = SessionManager.ROLE_OPERATIONS)
        val attendance = FakeAttendanceRepository(
            listOf(at(8, 0, AttendanceType.HOME_IN), at(9, 0, AttendanceType.SITE_IN))
        )
        val vm = subject(session = session, attendance = attendance)
        advanceUntilIdle()

        assertTrue(vm.uiState.value.logoutWouldEndDay)
    }

    @Test
    fun `logout would not end the day once it is already complete`() = runTest(dispatcher) {
        val session = FakeSessionManager(role = SessionManager.ROLE_OPERATIONS)
        val attendance = FakeAttendanceRepository(
            listOf(
                at(8, 0, AttendanceType.HOME_IN),
                at(9, 0, AttendanceType.SITE_IN),
                at(17, 0, AttendanceType.SITE_OUT),
                at(18, 0, AttendanceType.HOME_OUT),
            )
        )
        val vm = subject(session = session, attendance = attendance)
        advanceUntilIdle()

        assertFalse(vm.uiState.value.logoutWouldEndDay)
    }
}
