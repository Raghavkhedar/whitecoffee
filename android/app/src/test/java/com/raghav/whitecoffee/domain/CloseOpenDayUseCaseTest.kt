package com.raghav.whitecoffee.domain

import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.DayClosePath
import com.raghav.whitecoffee.data.session.SessionManager
import com.raghav.whitecoffee.fake.FakeAttendanceRepository
import com.raghav.whitecoffee.fake.FakeLocationProvider
import com.raghav.whitecoffee.fake.FakeSessionManager
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Closing an open day at logout.
 *
 * Every assertion here is about pay. The nightly compute scores a day whose check-in has no
 * matching check-out as LNF — half a day's wage — so an event this use case fails to write is
 * money the employee does not receive. The sales cases are the ones that have actually bitten:
 * sales is hybrid, so its closing path cannot be inferred from the role.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CloseOpenDayUseCaseTest {

    private fun event(type: String, siteName: String = "", marketName: String = "", locationName: String = "") =
        AttendanceRecord(
            id = "e-$type", userId = "u1", date = "2026-07-25", type = type,
            siteName = siteName, siteId = if (siteName.isEmpty()) "" else "S-1",
            marketName = marketName, locationName = locationName,
        )

    private fun useCase(
        events: List<AttendanceRecord>,
        role: String,
        location: LocationState = LocationState.Success(28.6139, 77.2090),
    ): Triple<CloseOpenDayUseCase, FakeAttendanceRepository, FakeLocationProvider> {
        val repo = FakeAttendanceRepository(events)
        val loc = FakeLocationProvider(next = location)
        val session = FakeSessionManager(role = role)
        return Triple(CloseOpenDayUseCase(repo, loc, session), repo, loc)
    }

    /** Event types written *by the use case*, ignoring the ones already on the day. */
    private fun written(repo: FakeAttendanceRepository, preExisting: Int) =
        repo.recorded.drop(preExisting).map { it.type }

    // ── Operations ────────────────────────────────────────────────────────

    @Test
    fun `ops checked in at a site closes the site then the day`() = runTest {
        val events = listOf(event(AttendanceType.HOME_IN), event(AttendanceType.SITE_IN, siteName = "Gurugaon"))
        val (close, repo, _) = useCase(events, SessionManager.ROLE_OPERATIONS)

        val outcome = close()

        assertEquals(
            CloseDayOutcome.Closed(DayClosePath.FIELD, listOf(AttendanceType.SITE_OUT, AttendanceType.HOME_OUT)),
            outcome
        )
        assertEquals(listOf(AttendanceType.SITE_OUT, AttendanceType.HOME_OUT), written(repo, events.size))
    }

    @Test
    fun `site checkout carries the site identity forward`() = runTest {
        val events = listOf(event(AttendanceType.HOME_IN), event(AttendanceType.SITE_IN, siteName = "Gurugaon"))
        val (close, repo, _) = useCase(events, SessionManager.ROLE_OPERATIONS)

        close()

        // Payroll pairs in/out by site; a checkout that loses the name cannot be matched up.
        val siteOut = repo.recorded.first { it.type == AttendanceType.SITE_OUT }
        assertEquals("Gurugaon", siteOut.siteName)
        assertEquals("S-1", siteOut.siteId)
    }

    @Test
    fun `ops checked in at a market closes the market then the day`() = runTest {
        val events = listOf(event(AttendanceType.HOME_IN), event(AttendanceType.MARKET_IN, marketName = "Sadar"))
        val (close, repo, _) = useCase(events, SessionManager.ROLE_OPERATIONS)

        close()

        assertEquals(listOf(AttendanceType.MARKET_OUT, AttendanceType.HOME_OUT), written(repo, events.size))
        assertEquals("Sadar", repo.recorded.first { it.type == AttendanceType.MARKET_OUT }.marketName)
    }

    @Test
    fun `ops only home checked in writes just the home out`() = runTest {
        val events = listOf(event(AttendanceType.HOME_IN))
        val (close, repo, _) = useCase(events, SessionManager.ROLE_OPERATIONS)

        close()

        assertEquals(listOf(AttendanceType.HOME_OUT), written(repo, events.size))
    }

    // ── Office ────────────────────────────────────────────────────────────

    @Test
    fun `office still in the office closes the office session then the day`() = runTest {
        val events = listOf(event(AttendanceType.HOME_IN), event(AttendanceType.OFFICE_IN, locationName = "HQ"))
        val (close, repo, _) = useCase(events, SessionManager.ROLE_OFFICE)

        val outcome = close()

        assertEquals(
            CloseDayOutcome.Closed(DayClosePath.OFFICE, listOf(AttendanceType.OFFICE_OUT, AttendanceType.HOME_OUT)),
            outcome
        )
        assertEquals("HQ", repo.recorded.first { it.type == AttendanceType.OFFICE_OUT }.locationName)
    }

    @Test
    fun `office already checked out of the office writes only the home out`() = runTest {
        val events = listOf(
            event(AttendanceType.HOME_IN),
            event(AttendanceType.OFFICE_IN, locationName = "HQ"),
            event(AttendanceType.OFFICE_OUT, locationName = "HQ"),
        )
        val (close, repo, _) = useCase(events, SessionManager.ROLE_OFFICE)

        close()

        assertEquals(listOf(AttendanceType.HOME_OUT), written(repo, events.size))
    }

    // ── Sales: the hybrid, and the reason this use case exists ────────────

    @Test
    fun `sales checked in at a site takes the FIELD path, not the office path`() = runTest {
        val events = listOf(event(AttendanceType.HOME_IN), event(AttendanceType.SITE_IN, siteName = "Client A"))
        val (close, repo, _) = useCase(events, SessionManager.ROLE_SALES)

        val outcome = close()

        // The bug this guards: dispatching sales on the role sends it down the office path,
        // leaving site_in unclosed → nightly compute scores the day LNF → half pay.
        assertEquals(DayClosePath.FIELD, (outcome as CloseDayOutcome.Closed).path)
        assertEquals(listOf(AttendanceType.SITE_OUT, AttendanceType.HOME_OUT), written(repo, events.size))
    }

    @Test
    fun `sales checked in at a market takes the FIELD path`() = runTest {
        val events = listOf(event(AttendanceType.HOME_IN), event(AttendanceType.MARKET_IN, marketName = "Sadar"))
        val (close, repo, _) = useCase(events, SessionManager.ROLE_SALES)

        close()

        assertEquals(listOf(AttendanceType.MARKET_OUT, AttendanceType.HOME_OUT), written(repo, events.size))
    }

    @Test
    fun `sales in the office takes the OFFICE path`() = runTest {
        val events = listOf(event(AttendanceType.HOME_IN), event(AttendanceType.OFFICE_IN, locationName = "HQ"))
        val (close, repo, _) = useCase(events, SessionManager.ROLE_SALES)

        val outcome = close()

        assertEquals(DayClosePath.OFFICE, (outcome as CloseDayOutcome.Closed).path)
        assertEquals(listOf(AttendanceType.OFFICE_OUT, AttendanceType.HOME_OUT), written(repo, events.size))
    }

    // ── Nothing to do, and failure ────────────────────────────────────────

    @Test
    fun `a day that never started writes nothing`() = runTest {
        val (close, repo, _) = useCase(emptyList(), SessionManager.ROLE_OPERATIONS)

        assertEquals(CloseDayOutcome.NothingOpen, close())
        assertTrue(repo.recorded.isEmpty())
    }

    @Test
    fun `an already closed day writes nothing`() = runTest {
        val events = listOf(event(AttendanceType.HOME_IN), event(AttendanceType.HOME_OUT))
        val (close, repo, _) = useCase(events, SessionManager.ROLE_OFFICE)

        assertEquals(CloseDayOutcome.NothingOpen, close())
        assertEquals(events.size, repo.recorded.size)
    }

    @Test
    fun `no GPS fix writes nothing rather than an event without coordinates`() = runTest {
        val events = listOf(event(AttendanceType.HOME_IN), event(AttendanceType.SITE_IN, siteName = "Gurugaon"))
        val (close, repo, _) = useCase(events, SessionManager.ROLE_OPERATIONS, location = LocationState.Timeout)

        assertEquals(CloseDayOutcome.NoLocation, close())
        assertEquals(events.size, repo.recorded.size)
    }

    @Test
    fun `an unreadable day reports Unknown and writes nothing`() = runTest {
        val repo = FakeAttendanceRepository(listOf(event(AttendanceType.SITE_IN, siteName = "Gurugaon")))
        repo.failWith = Exception("offline")
        val close = CloseOpenDayUseCase(
            repo, FakeLocationProvider(), FakeSessionManager(role = SessionManager.ROLE_OPERATIONS)
        )

        assertEquals(CloseDayOutcome.Unknown, close())
    }
}
