package com.raghav.whitecoffee.ui.attendance

import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.fake.FakeAttendanceRepository
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

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        repo = FakeAttendanceRepository()
        location = FakeLocationProvider()
    }

    @After
    fun tearDown() = Dispatchers.resetMain()

    private fun subject() = AttendanceViewModel(
        repo, location, FakeSessionManager(),
        RecordAttendanceEventUseCase(repo, location),
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
        val state = vm.actionState.value
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
        assertTrue(vm.actionState.value is AttendanceViewModel.ActionState.Error)
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
            assertTrue(vm.actionState.value is AttendanceViewModel.ActionState.Error)
        }

    @Test
    fun `a blank site name is refused and writes nothing`() = runTest(dispatcher) {
        val vm = subject()
        advanceUntilIdle()

        vm.homeCheckIn(); advanceUntilIdle()
        vm.confirmSiteCheckIn("S-001", "   "); advanceUntilIdle()

        assertEquals(listOf(AttendanceType.HOME_IN), types())
        assertTrue(vm.actionState.value is AttendanceViewModel.ActionState.Error)
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
        val state = vm.actionState.value
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
}
