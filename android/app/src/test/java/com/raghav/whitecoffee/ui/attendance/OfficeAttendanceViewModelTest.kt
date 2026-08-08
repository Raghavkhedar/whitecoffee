package com.raghav.whitecoffee.ui.attendance

import com.raghav.whitecoffee.data.model.OfficeState
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.notification.AttendanceEntry
import com.raghav.whitecoffee.fake.FakeAttendanceNotifier
import com.raghav.whitecoffee.fake.FakeAttendanceRepository
import com.raghav.whitecoffee.fake.FakeClock
import com.raghav.whitecoffee.fake.FakeLocationProvider
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Office attendance day machine: NotStarted → DayStarted ↔ InOffice → DayEnded.
 *
 * This is the first ViewModel test in the app. It became possible only once
 * AttendanceRepository, LocationProvider and NetworkMonitor became interfaces — before that
 * the subject could not be constructed without an Android Context.
 *
 * What it protects: the office day is a five-phase machine whose transitions decide which
 * buttons an employee sees. Showing the wrong button is not cosmetic here — `home_out` is
 * terminal, and an out-of-phase tap ends someone's working day.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OfficeAttendanceViewModelTest {

    private val dispatcher = StandardTestDispatcher()

    private lateinit var repo: FakeAttendanceRepository
    private lateinit var location: FakeLocationProvider
    private lateinit var clock: FakeClock
    private lateinit var notifier: FakeAttendanceNotifier

    private val today = "2026-07-25"
    private val yesterday = "2026-07-24"

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repo = FakeAttendanceRepository()
        location = FakeLocationProvider()
        clock = FakeClock(today)
        notifier = FakeAttendanceNotifier()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun subject() =
        OfficeAttendanceViewModel(repo, location, clock, notifier, FakeNetworkMonitor())

    @Test
    fun `a day with no punches starts NotStarted`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        assertEquals(OfficeState.NotStarted, vm.uiState.value.day)
    }

    @Test
    fun `home in starts the day`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeIn()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.day is OfficeState.DayStarted)
        assertEquals(listOf(AttendanceType.HOME_IN), repo.recorded.map { it.type })
    }

    @Test
    fun `office check-in and check-out cycle without ending the day`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeIn(); advanceUntilIdle()
        vm.checkIn("Head Office"); advanceUntilIdle()

        val inOffice = vm.uiState.value.day
        assertTrue(inOffice is OfficeState.InOffice)
        assertEquals(
            "Head Office",
            (inOffice as OfficeState.InOffice).locationName
        )

        vm.checkOut("Head Office"); advanceUntilIdle()

        // Back to DayStarted, NOT DayEnded — the office session cycles between the home gates.
        assertTrue(vm.uiState.value.day is OfficeState.DayStarted)

        // A second office session is allowed on the same day.
        vm.checkIn("Client Site"); advanceUntilIdle()
        assertTrue(vm.uiState.value.day is OfficeState.InOffice)

        assertEquals(
            listOf(
                AttendanceType.HOME_IN,
                AttendanceType.OFFICE_IN,
                AttendanceType.OFFICE_OUT,
                AttendanceType.OFFICE_IN
            ),
            repo.recorded.map { it.type }
        )
    }

    @Test
    fun `home out ends the day terminally`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeIn(); advanceUntilIdle()
        vm.homeOut(); advanceUntilIdle()

        assertTrue(vm.uiState.value.day is OfficeState.DayEnded)
    }

    @Test
    fun `check-in location name is trimmed before it is stored`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeIn(); advanceUntilIdle()
        vm.checkIn("   Head Office   "); advanceUntilIdle()

        assertEquals("Head Office", repo.recorded.last().locationName)
    }

    @Test
    fun `a denied GPS permission surfaces an error and records nothing`() = runTest(dispatcher) {
        location.next = LocationState.PermissionDenied
        val vm = subject()
        advanceUntilIdle()

        vm.homeIn()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.day is OfficeState.Error)
        assertTrue("no punch may be written without a fix", repo.recorded.isEmpty())
    }

    @Test
    fun `a failed write surfaces an error and does not advance the day`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        repo.failWith = IllegalStateException("offline")
        vm.homeIn()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.day is OfficeState.Error)
    }

    /**
     * Stress test #2.1 — a double tap must not write two punches. The guard is a plain
     * `isSubmitting` boolean set before the coroutine launches; this is the first automated
     * check that it actually holds.
     */
    @Test
    fun `a double tap records only one punch`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeIn()
        vm.homeIn()   // second tap arrives before the first write completes
        advanceUntilIdle()

        assertEquals(1, repo.recorded.size)
        assertEquals(1, location.calls)
    }

    // ── write-time legality guard ─────────────────────────────────────────
    //
    // The office flow used to gate only on which buttons were drawn. Button visibility is UX,
    // not a guarantee: a tap landing a frame after home_out reached Firestore and reopened a
    // finished day, and the nightly compute scores whatever it finds. These assert on
    // repo.recorded — that the punch never reached the repository at all, not merely that the
    // screen showed an error afterwards.

    @Test
    fun `nothing may be recorded once the day is complete`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeIn(); advanceUntilIdle()
        vm.homeOut(); advanceUntilIdle()
        val afterClose = repo.recorded.size

        vm.homeIn(); advanceUntilIdle()
        vm.checkIn("Head Office"); advanceUntilIdle()
        vm.checkOut("Head Office"); advanceUntilIdle()
        vm.homeOut(); advanceUntilIdle()

        assertEquals("no punch may follow home_out", afterClose, repo.recorded.size)
        val state = vm.uiState.value.day
        assertTrue(state is OfficeState.Error)
        assertEquals("Your day is already complete.", (state as OfficeState.Error).message)
    }

    @Test
    fun `office check-in is refused before the day has started`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.checkIn("Head Office")
        advanceUntilIdle()

        assertTrue(repo.recorded.isEmpty())
        assertTrue(vm.uiState.value.day is OfficeState.Error)
    }

    @Test
    fun `office check-out is refused when no session is open`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeIn(); advanceUntilIdle()
        val afterHomeIn = repo.recorded.size

        vm.checkOut("Head Office")
        advanceUntilIdle()

        assertEquals(afterHomeIn, repo.recorded.size)
        assertTrue(vm.uiState.value.day is OfficeState.Error)
    }

    /**
     * Ending the day mid-session would leave the `office_in` unclosed, so payroll has no closing
     * punch to score against — the office equivalent of the unclosed `site_in` that scores LNF.
     */
    @Test
    fun `ending the day is refused while still checked into the office`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeIn(); advanceUntilIdle()
        vm.checkIn("Head Office"); advanceUntilIdle()
        val beforeHomeOut = repo.recorded.size

        vm.homeOut()
        advanceUntilIdle()

        assertEquals("home_out must not land mid-session", beforeHomeOut, repo.recorded.size)
        val state = vm.uiState.value.day
        assertTrue(state is OfficeState.Error)
        assertEquals(
            "Check out of the office before ending your day.",
            (state as OfficeState.Error).message,
        )
    }

    @Test
    fun `a second home check-in cannot restart a running day`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeIn(); advanceUntilIdle()
        val afterFirst = repo.recorded.size

        vm.homeIn()
        advanceUntilIdle()

        assertEquals("home_in is once per day", afterFirst, repo.recorded.size)
    }

    // ── the day-rollover guard ────────────────────────────────────────────
    //
    // THE most expensive bug this suite covers. The app computed "today" once, in init, and
    // `observeTodayData()` baked the date into its Firestore query outside the flow builder, so an
    // app left open overnight woke up holding YESTERDAY's events. The phase guard above then did
    // its job perfectly against the wrong day — it saw an open office session and waved an
    // `office_out` through — and the write landed stamped with the REAL today. Production shows
    // exactly this: employee S338's 2026-08-08 opens with an `office_out`, and 2026-08-07 was left
    // unclosed and scored LNF = half pay.
    //
    // These assert on repo.recorded: that the punch never reached the repository at all.

    /** A seeded punch from some other day. `timestamp` is irrelevant — only `date` is judged. */
    private fun seed(type: String, date: String) = AttendanceRecord(
        id = "seed-$type", userId = "u1", date = date, type = type,
    )

    @Test
    fun `an office check-out is refused when the events on screen are yesterday's`() =
        runTest(dispatcher) {
            // Yesterday: started the day and checked into the office, never checked out.
            repo = FakeAttendanceRepository(
                listOf(seed(AttendanceType.HOME_IN, yesterday), seed(AttendanceType.OFFICE_IN, yesterday))
            )
            val vm = subject()
            advanceUntilIdle()

            // The phase read off those events is InOffice, so the phase guard alone would allow it.
            assertTrue(vm.uiState.value.day is OfficeState.InOffice)
            val before = repo.recorded.size

            vm.checkOut("Head Office")
            advanceUntilIdle()

            assertEquals(
                "an office_out must never be authorised from another day's events",
                before,
                repo.recorded.size,
            )
            assertNotNull("the refusal must explain itself", vm.uiState.value.notice)
        }

    @Test
    fun `home out is refused when the events on screen are yesterday's`() = runTest(dispatcher) {
        repo = FakeAttendanceRepository(listOf(seed(AttendanceType.HOME_IN, yesterday)))
        val vm = subject()
        advanceUntilIdle()
        val before = repo.recorded.size

        vm.homeOut()
        advanceUntilIdle()

        assertEquals("home_out is terminal — it must land on the right day", before, repo.recorded.size)
        assertNotNull(vm.uiState.value.notice)
    }

    /** The refusal must also RELOAD, or the employee is stuck looking at yesterday forever. */
    @Test
    fun `a refused stale punch reloads the day and then lets the new one start`() =
        runTest(dispatcher) {
            repo = FakeAttendanceRepository(listOf(seed(AttendanceType.HOME_IN, yesterday)))
            val vm = subject()
            advanceUntilIdle()

            // The new day has no punches yet — this is what the reload will find.
            repo.setEvents(emptyList())

            vm.homeIn()          // refused: derived from yesterday's events
            advanceUntilIdle()
            assertTrue("nothing may be written from a stale day", repo.recorded.isEmpty())
            assertNotNull(vm.uiState.value.notice)
            assertEquals(OfficeState.NotStarted, vm.uiState.value.day)

            vm.homeIn()          // accepted: the reload left today's (empty) events on screen
            advanceUntilIdle()

            assertEquals(listOf(AttendanceType.HOME_IN), repo.recorded.map { it.type })
            assertEquals(today, repo.recorded.single().date)
            assertNull("a completed punch clears the notice", vm.uiState.value.notice)
        }

    /** The guard must not fire on the ordinary case — every event already belongs to today. */
    @Test
    fun `today's own events are never treated as stale`() = runTest(dispatcher) {
        repo = FakeAttendanceRepository(listOf(seed(AttendanceType.HOME_IN, today)))
        val vm = subject()
        advanceUntilIdle()

        vm.checkIn("Head Office")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.day is OfficeState.InOffice)
        assertNull(vm.uiState.value.notice)
    }

    // ── ongoing "still checked in" reminder ───────────────────────────────

    @Test
    fun `an office check-in posts the ongoing reminder and check-out clears it`() =
        runTest(dispatcher) {
            val vm = subject()
            advanceUntilIdle()

            vm.homeIn(); advanceUntilIdle()
            assertNull("home_in is a commute marker — no office session is open", notifier.showing)

            vm.checkIn("Head Office"); advanceUntilIdle()
            assertNotNull("an open office_in must be reminded about", notifier.showing)
            assertEquals(AttendanceEntry.OFFICE, notifier.showing?.entry)

            vm.checkOut("Head Office"); advanceUntilIdle()
            assertNull("the matching office_out must take the reminder down", notifier.showing)
        }

    @Test
    fun `ending the day clears the ongoing reminder`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeIn(); advanceUntilIdle()
        vm.checkIn("Head Office"); advanceUntilIdle()
        vm.checkOut("Head Office"); advanceUntilIdle()
        vm.homeOut(); advanceUntilIdle()

        assertNull(notifier.showing)
        assertTrue(vm.uiState.value.day is OfficeState.DayEnded)
    }

    /** The guard must not block the ordinary day — a full legal cycle still writes every leg. */
    @Test
    fun `a full legal office day still records every leg`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeIn(); advanceUntilIdle()
        vm.checkIn("Head Office"); advanceUntilIdle()
        vm.checkOut("Head Office"); advanceUntilIdle()
        vm.homeIn(); advanceUntilIdle()          // refused — already started
        vm.checkIn("Client Site"); advanceUntilIdle()
        vm.checkOut("Client Site"); advanceUntilIdle()
        vm.homeOut(); advanceUntilIdle()

        assertEquals(
            listOf(
                AttendanceType.HOME_IN,
                AttendanceType.OFFICE_IN,
                AttendanceType.OFFICE_OUT,
                AttendanceType.OFFICE_IN,
                AttendanceType.OFFICE_OUT,
                AttendanceType.HOME_OUT,
            ),
            repo.recorded.map { it.type },
        )
    }
}
