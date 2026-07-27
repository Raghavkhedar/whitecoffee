package com.raghav.whitecoffee.domain

import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.fake.FakeAttendanceRepository
import com.raghav.whitecoffee.fake.FakeLocationProvider
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The write-time guard on every attendance punch.
 *
 * This runs immediately before the write, not when the button was drawn. A check-in button can
 * survive on screen for a frame after `home_out` lands, and the tap that follows must not reach
 * Firestore — `home_out` is terminal, so a punch accepted after it would corrupt a day that
 * payroll has already effectively closed.
 */
class RecordAttendanceEventUseCaseTest {

    private fun subject(
        location: LocationState = LocationState.Success(28.6139, 77.2090),
    ): Pair<RecordAttendanceEventUseCase, FakeAttendanceRepository> {
        val repo = FakeAttendanceRepository()
        return RecordAttendanceEventUseCase(repo, FakeLocationProvider(next = location)) to repo
    }

    private fun homeRecord() = AttendanceRecord(id = "e1", userId = "u1", type = AttendanceType.HOME_IN)

    @Test
    fun `a legal punch is written`() = runTest {
        val (record, repo) = subject()

        val outcome = record(AttendanceState.NoRecord, AttendanceType.HOME_IN)

        assertTrue(outcome is RecordEventOutcome.Recorded)
        assertEquals(listOf(AttendanceType.HOME_IN), repo.recorded.map { it.type })
    }

    @Test
    fun `an out-of-order punch never reaches the repository`() = runTest {
        val (record, repo) = subject()

        // SITE_IN requires HomeCheckedIn; from NoRecord it is illegal.
        val outcome = record(AttendanceState.NoRecord, AttendanceType.SITE_IN)

        assertEquals(RecordEventOutcome.NotAllowed(dayAlreadyComplete = false), outcome)
        assertTrue("nothing may be written when the transition is illegal", repo.recorded.isEmpty())
    }

    @Test
    fun `a completed day reports itself distinctly so the user gets the right message`() = runTest {
        val (record, repo) = subject()

        val outcome = record(AttendanceState.DayComplete, AttendanceType.HOME_IN)

        assertEquals(RecordEventOutcome.NotAllowed(dayAlreadyComplete = true), outcome)
        assertTrue(repo.recorded.isEmpty())
    }

    @Test
    fun `no GPS fix means no write`() = runTest {
        val (record, repo) = subject(location = LocationState.GpsDisabled)

        val outcome = record(AttendanceState.NoRecord, AttendanceType.HOME_IN)

        assertEquals(RecordEventOutcome.NoLocation(LocationState.GpsDisabled), outcome)
        assertTrue("an event without coordinates is worse than no event", repo.recorded.isEmpty())
    }

    @Test
    fun `site details are carried onto the written event`() = runTest {
        val (record, repo) = subject()

        record(
            AttendanceState.HomeCheckedIn(homeRecord()),
            AttendanceType.SITE_IN,
            siteId = "S-1",
            siteName = "Gurugaon",
        )

        val written = repo.recorded.single()
        assertEquals("Gurugaon", written.siteName)
        assertEquals("S-1", written.siteId)
    }

    @Test
    fun `a repository failure is reported rather than swallowed`() = runTest {
        val repo = FakeAttendanceRepository()
        repo.failWith = Exception("offline")
        val record = RecordAttendanceEventUseCase(repo, FakeLocationProvider())

        val outcome = record(AttendanceState.NoRecord, AttendanceType.HOME_IN)

        assertTrue(outcome is RecordEventOutcome.Failed)
    }

    @Test
    fun `every location failure has exactly one wording`() {
        // Seven call sites used to spell these themselves, and had already drifted into four
        // different phrasings of "accuracy too low".
        val messages = listOf(
            LocationState.GpsDisabled, LocationState.PermissionDenied,
            LocationState.LowAccuracy, LocationState.Timeout,
        ).map { it.toUserMessage() }

        assertEquals(messages.size, messages.distinct().size)
        assertTrue(messages.none { it.isBlank() })
    }
}
