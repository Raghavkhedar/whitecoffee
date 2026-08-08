package com.raghav.whitecoffee.ui.attendance

import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.notification.AttendanceEntry
import com.raghav.whitecoffee.fake.FakeAttendanceNotifier
import com.raghav.whitecoffee.fake.FakeAttendanceRepository
import com.raghav.whitecoffee.fake.FakeClock
import com.raghav.whitecoffee.fake.FakeLocationProvider
import com.raghav.whitecoffee.fake.FakeNetworkMonitor
import com.raghav.whitecoffee.domain.RecordAttendanceEventUseCase
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Operations attendance: NoRecord → HomeCheckedIn → SiteCheckedIn ⇄ MarketCheckedIn → DayComplete.
 *
 * This ViewModel decides whether a punch reaches Firestore. Every assertion here is about money:
 * a punch that should not have been written, or one that should have been and wasn't, changes
 * what the nightly scoring function pays that employee.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AttendanceViewModelTest {

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

    private fun subject() = AttendanceViewModel(
        repo, location, FakeSessionManager(),
        RecordAttendanceEventUseCase(repo, location),
        clock, notifier,
        FakeNetworkMonitor()
    )

    private fun types() = repo.recorded.map { it.type }

    @Test
    fun `a full operations day records every leg in order`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeCheckIn(); advanceUntilIdle()
        vm.confirmSiteCheckIn("S-001", "Gurugaon Site"); advanceUntilIdle()
        vm.siteCheckOut("S-001", "Gurugaon Site"); advanceUntilIdle()
        vm.homeCheckOut(); advanceUntilIdle()

        assertEquals(
            listOf(
                AttendanceType.HOME_IN,
                AttendanceType.SITE_IN,
                AttendanceType.SITE_OUT,
                AttendanceType.HOME_OUT
            ),
            types()
        )
    }

    /**
     * `home_out` is terminal — deriveAttendanceState returns DayComplete for good. The write-time
     * guard must stop a stale button from reaching the repository, not merely fail to render.
     */
    @Test
    fun `nothing may be recorded after the day is complete`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeCheckIn(); advanceUntilIdle()
        vm.homeCheckOut(); advanceUntilIdle()
        val afterClose = repo.recorded.size

        vm.homeCheckIn(); advanceUntilIdle()
        vm.confirmSiteCheckIn("S-001", "Gurugaon Site"); advanceUntilIdle()
        vm.initiateMarketCheckIn(); advanceUntilIdle()

        assertEquals("no punch may follow home_out", afterClose, repo.recorded.size)
        val state = vm.uiState.value.action
        assertTrue(state is AttendanceViewModel.ActionState.Error)
        assertEquals(
            "Your day is already complete.",
            (state as AttendanceViewModel.ActionState.Error).message
        )
    }

    @Test
    fun `site check-in is refused before home check-in`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.confirmSiteCheckIn("S-001", "Gurugaon Site")
        advanceUntilIdle()

        assertTrue(repo.recorded.isEmpty())
        assertTrue(vm.uiState.value.action is AttendanceViewModel.ActionState.Error)
    }

    /**
     * Moving from a site to a market must close the site visit first. The site_out/site_in pair
     * is what the Manpower Utilisation report pairs into a visit — an unclosed site_in leaves a
     * visible gap in that report and scores the day LNF.
     */
    @Test
    fun `market check-in from a site auto-records the site check-out first`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeCheckIn(); advanceUntilIdle()
        vm.confirmSiteCheckIn("S-001", "Gurugaon Site"); advanceUntilIdle()
        vm.confirmMarketCheckIn("Sadar Bazaar", 28.6, 77.2); advanceUntilIdle()

        assertEquals(
            listOf(
                AttendanceType.HOME_IN,
                AttendanceType.SITE_IN,
                AttendanceType.SITE_OUT,
                AttendanceType.MARKET_IN
            ),
            types()
        )
        // The auto-closed site_out must carry the site it is closing, not blank fields.
        val siteOut = repo.recorded[2]
        assertEquals("S-001", siteOut.siteId)
        assertEquals("Gurugaon Site", siteOut.siteName)
    }

    @Test
    fun `a failed auto site check-out aborts before the market punch is written`() =
        runTest(dispatcher) {
            val vm = subject()
            advanceUntilIdle()

            vm.homeCheckIn(); advanceUntilIdle()
            vm.confirmSiteCheckIn("S-001", "Gurugaon Site"); advanceUntilIdle()

            repo.failWith = IllegalStateException("write failed")
            vm.confirmMarketCheckIn("Sadar Bazaar", 28.6, 77.2); advanceUntilIdle()

            // Still just home_in + site_in — no orphaned market_in without its site_out.
            assertEquals(
                listOf(AttendanceType.HOME_IN, AttendanceType.SITE_IN),
                types()
            )
            assertTrue(vm.uiState.value.action is AttendanceViewModel.ActionState.Error)
        }

    @Test
    fun `a blank site name is refused and writes nothing`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeCheckIn(); advanceUntilIdle()
        vm.confirmSiteCheckIn("S-001", "   "); advanceUntilIdle()

        assertEquals(listOf(AttendanceType.HOME_IN), types())
        assertTrue(vm.uiState.value.action is AttendanceViewModel.ActionState.Error)
    }

    @Test
    fun `site name and id are trimmed before they are stored`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeCheckIn(); advanceUntilIdle()
        vm.confirmSiteCheckIn("  S-001  ", "  Gurugaon Site  "); advanceUntilIdle()

        val siteIn = repo.recorded.last()
        assertEquals("S-001", siteIn.siteId)
        assertEquals("Gurugaon Site", siteIn.siteName)
    }

    @Test
    fun `GPS failure records no punch and reports the reason`() = runTest(dispatcher) {
        location.next = LocationState.GpsDisabled
        val vm = subject()
        advanceUntilIdle()

        vm.homeCheckIn(); advanceUntilIdle()

        assertTrue(repo.recorded.isEmpty())
        val state = vm.uiState.value.action
        assertTrue(state is AttendanceViewModel.ActionState.Error)
        assertTrue(
            (state as AttendanceViewModel.ActionState.Error).message.contains("GPS is disabled")
        )
    }

    /** Stress test #2.1 — a double tap must not create a duplicate attendance document. */
    @Test
    fun `a double tap records only one punch`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeCheckIn()
        vm.homeCheckIn()
        advanceUntilIdle()

        assertEquals(1, repo.recorded.size)
        assertEquals(1, location.calls)
    }

    // ── the day-rollover guard ────────────────────────────────────────────
    //
    // `observeTodayData()` used to read LocalDate.now() OUTSIDE its flow builder, baking a fixed
    // date into the Firestore query for the life of the subscription; the ViewModel loaded once,
    // in init. An app left open overnight therefore kept receiving yesterday's documents, the
    // phase derived from them still looked like an open site visit, and the `site_out` it
    // authorised was stamped with the REAL today — leaving yesterday with an unclosed `site_in`,
    // which the nightly compute scores LNF = half pay.
    //
    // These assert on repo.recorded: that the punch never reached the repository at all.

    /** A seeded punch from some other day. Only `date` is judged here. */
    private fun seed(type: String, date: String) = AttendanceRecord(
        id = "seed-$type", userId = "u1", date = date, type = type,
    )

    @Test
    fun `a site check-out is refused when the events on screen are yesterday's`() =
        runTest(dispatcher) {
            // Yesterday: left home and checked into a site, never checked out.
            repo = FakeAttendanceRepository(
                listOf(seed(AttendanceType.HOME_IN, yesterday), seed(AttendanceType.SITE_IN, yesterday))
            )
            val vm = subject()
            advanceUntilIdle()
            val before = repo.recorded.size

            vm.siteCheckOut("S-001", "Gurugaon Site")
            advanceUntilIdle()

            assertEquals(
                "a site_out must never be authorised from another day's events",
                before,
                repo.recorded.size,
            )
            val action = vm.uiState.value.action
            assertTrue(action is AttendanceViewModel.ActionState.Error)
        }

    @Test
    fun `home check-out is refused when the events on screen are yesterday's`() =
        runTest(dispatcher) {
            repo = FakeAttendanceRepository(listOf(seed(AttendanceType.HOME_IN, yesterday)))
            val vm = subject()
            advanceUntilIdle()
            val before = repo.recorded.size

            vm.homeCheckOut()
            advanceUntilIdle()

            assertEquals(
                "home_out is terminal — it must land on the right day",
                before,
                repo.recorded.size,
            )
            assertTrue(vm.uiState.value.action is AttendanceViewModel.ActionState.Error)
        }

    /** The dialog-opening guard is on the same path — a stale day must not even offer the form. */
    @Test
    fun `the site check-in dialog is refused when the events on screen are yesterday's`() =
        runTest(dispatcher) {
            repo = FakeAttendanceRepository(listOf(seed(AttendanceType.HOME_IN, yesterday)))
            val vm = subject()
            advanceUntilIdle()

            vm.initiateSiteCheckIn()
            advanceUntilIdle()

            assertTrue(vm.uiState.value.action is AttendanceViewModel.ActionState.Error)
        }

    /**
     * The refusal must also RE-SUBSCRIBE, or the employee is stuck on yesterday forever.
     *
     * Staged deliberately: the seeded events stay in place across the refused tap, because
     * swapping them out first would let the ordinary phase guard refuse the punch and this test
     * would pass without the freshness check existing at all.
     */
    @Test
    fun `a refused stale punch re-subscribes to today and then lets the new day start`() =
        runTest(dispatcher) {
            repo = FakeAttendanceRepository(listOf(seed(AttendanceType.HOME_IN, yesterday)))
            val vm = subject()
            advanceUntilIdle()
            val seeded = repo.recorded.size
            val subscriptionsBefore = repo.loads

            // The phase says HomeCheckedIn, so home_out is a legal transition — on yesterday.
            vm.homeCheckOut()
            advanceUntilIdle()

            assertEquals("nothing may be written from a stale day", seeded, repo.recorded.size)
            assertTrue(
                "a stale screen must re-subscribe, not sit on yesterday",
                repo.loads > subscriptionsBefore,
            )

            // The new day's (empty) punches arrive on the fresh subscription.
            repo.setEvents(emptyList())
            advanceUntilIdle()

            vm.homeCheckIn()
            advanceUntilIdle()

            assertEquals(listOf(AttendanceType.HOME_IN), types())
            assertEquals(today, repo.recorded.single().date)
        }

    /** The guard must not fire on the ordinary case — every event already belongs to today. */
    @Test
    fun `today's own events are never treated as stale`() = runTest(dispatcher) {
        repo = FakeAttendanceRepository(listOf(seed(AttendanceType.HOME_IN, today)))
        val vm = subject()
        advanceUntilIdle()

        vm.confirmSiteCheckIn("S-001", "Gurugaon Site")
        advanceUntilIdle()

        assertEquals(AttendanceType.SITE_IN, repo.recorded.last().type)
    }

    // ── ongoing "still checked in" reminder ───────────────────────────────

    @Test
    fun `a site check-in posts the ongoing reminder and check-out clears it`() =
        runTest(dispatcher) {
            val vm = subject()
            advanceUntilIdle()

            vm.homeCheckIn(); advanceUntilIdle()
            assertNull("home_in is a commute marker and is never scored", notifier.showing)

            vm.confirmSiteCheckIn("S-001", "Gurugaon Site"); advanceUntilIdle()
            assertNotNull("an unclosed site_in is what scores LNF — remind them", notifier.showing)
            assertEquals(AttendanceEntry.OPERATIONS, notifier.showing?.entry)

            vm.siteCheckOut("S-001", "Gurugaon Site"); advanceUntilIdle()
            assertNull("the matching site_out must take the reminder down", notifier.showing)
        }

    @Test
    fun `a market check-in keeps the reminder up and ending the day clears it`() =
        runTest(dispatcher) {
            val vm = subject()
            advanceUntilIdle()

            vm.homeCheckIn(); advanceUntilIdle()
            vm.confirmMarketCheckIn("Sadar Bazaar", 28.6, 77.2); advanceUntilIdle()
            assertNotNull(notifier.showing)

            vm.marketCheckOut("Sadar Bazaar"); advanceUntilIdle()
            assertNull(notifier.showing)

            vm.homeCheckOut(); advanceUntilIdle()
            assertNull(notifier.showing)
        }
}
