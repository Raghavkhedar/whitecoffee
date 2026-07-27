package com.raghav.whitecoffee

import com.google.firebase.Timestamp
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.OfficeState
import com.raghav.whitecoffee.data.model.deriveOfficeState
import com.raghav.whitecoffee.data.model.hasOpenOfficeSession
import com.raghav.whitecoffee.data.model.isOfficeEventAllowed
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.Date

/**
 * The office day state machine and its write-time legality rule.
 *
 * [isOfficeEventAllowed] is the office counterpart of `isEventAllowed`, and it exists because the
 * office flow had **no** write-time check at all: it gated only on which buttons were drawn, so a
 * stale tap reached Firestore and could reopen a day that `home_out` had already closed. The
 * nightly compute then scores whatever it finds, which is why this is a pay question and not a
 * cosmetic one.
 */
class OfficeAttendanceStateTest {

    private fun at(hour: Int, minute: Int, type: String, locationName: String = ""): AttendanceRecord {
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute); set(Calendar.SECOND, 0)
        }
        return AttendanceRecord(
            type = type,
            timestamp = Timestamp(Date(cal.timeInMillis)),
            locationName = locationName,
        )
    }

    private val homeIn = at(9, 30, AttendanceType.HOME_IN)
    private val officeIn = at(10, 0, AttendanceType.OFFICE_IN, "Head Office")
    private val officeOut = at(17, 0, AttendanceType.OFFICE_OUT, "Head Office")
    private val homeOut = at(18, 30, AttendanceType.HOME_OUT)

    // ── deriveOfficeState ─────────────────────────────────────────────────

    @Test
    fun `no events is a day not started`() {
        assertEquals(OfficeState.NotStarted, deriveOfficeState(emptyList()))
    }

    @Test
    fun `home_in alone starts the day`() {
        assertTrue(deriveOfficeState(listOf(homeIn)) is OfficeState.DayStarted)
    }

    @Test
    fun `an open office_in reports the location it was made from`() {
        val state = deriveOfficeState(listOf(homeIn, officeIn))
        assertTrue(state is OfficeState.InOffice)
        assertEquals("Head Office", (state as OfficeState.InOffice).locationName)
    }

    @Test
    fun `office_out returns the day to started, so the cycle can repeat`() {
        assertTrue(deriveOfficeState(listOf(homeIn, officeIn, officeOut)) is OfficeState.DayStarted)
    }

    /** `home_out` is terminal — checked before everything else so nothing can reopen the day. */
    @Test
    fun `home_out ends the day even with a later stray event`() {
        val stray = at(19, 0, AttendanceType.OFFICE_IN, "Head Office")
        assertTrue(deriveOfficeState(listOf(homeIn, homeOut, stray)) is OfficeState.DayEnded)
    }

    @Test
    fun `an open session is reported only while checked in`() {
        assertFalse(hasOpenOfficeSession(listOf(homeIn)))
        assertTrue(hasOpenOfficeSession(listOf(homeIn, officeIn)))
        assertFalse(hasOpenOfficeSession(listOf(homeIn, officeIn, officeOut)))
    }

    // ── isOfficeEventAllowed ──────────────────────────────────────────────

    @Test
    fun `home_in may only start a day that has not started`() {
        assertTrue(isOfficeEventAllowed(OfficeState.NotStarted, AttendanceType.HOME_IN))
        assertFalse(isOfficeEventAllowed(OfficeState.DayStarted("9:30"), AttendanceType.HOME_IN))
        assertFalse(isOfficeEventAllowed(OfficeState.DayEnded("18:30"), AttendanceType.HOME_IN))
    }

    @Test
    fun `office_in needs a started day and no open session`() {
        assertTrue(isOfficeEventAllowed(OfficeState.DayStarted("9:30"), AttendanceType.OFFICE_IN))
        assertFalse(isOfficeEventAllowed(OfficeState.NotStarted, AttendanceType.OFFICE_IN))
        assertFalse(
            isOfficeEventAllowed(OfficeState.InOffice("Head Office", "10:00"), AttendanceType.OFFICE_IN)
        )
    }

    @Test
    fun `office_out needs an open session`() {
        assertTrue(
            isOfficeEventAllowed(OfficeState.InOffice("Head Office", "10:00"), AttendanceType.OFFICE_OUT)
        )
        assertFalse(isOfficeEventAllowed(OfficeState.DayStarted("9:30"), AttendanceType.OFFICE_OUT))
    }

    /**
     * Ending the day mid-session would leave the `office_in` unclosed, so the day has no closing
     * punch for payroll to score against — the office equivalent of the unclosed `site_in` that
     * scores LNF.
     */
    @Test
    fun `home_out is refused while still checked into the office`() {
        assertFalse(
            isOfficeEventAllowed(OfficeState.InOffice("Head Office", "10:00"), AttendanceType.HOME_OUT)
        )
        assertTrue(isOfficeEventAllowed(OfficeState.DayStarted("9:30"), AttendanceType.HOME_OUT))
    }

    /** The bug this guard was added for: a finished day must stay finished. */
    @Test
    fun `nothing at all may follow home_out`() {
        val ended = OfficeState.DayEnded("18:30")
        listOf(
            AttendanceType.HOME_IN,
            AttendanceType.HOME_OUT,
            AttendanceType.OFFICE_IN,
            AttendanceType.OFFICE_OUT,
        ).forEach {
            assertFalse("$it must be refused after home_out", isOfficeEventAllowed(ended, it))
        }
    }

    /**
     * Loading and Error are not day phases. Guessing from an unknown state is how a duplicate
     * punch gets written, so both deny everything.
     */
    @Test
    fun `an unknown phase permits nothing`() {
        listOf(OfficeState.Loading, OfficeState.Error("boom")).forEach { state ->
            listOf(
                AttendanceType.HOME_IN,
                AttendanceType.HOME_OUT,
                AttendanceType.OFFICE_IN,
                AttendanceType.OFFICE_OUT,
            ).forEach {
                assertFalse("$it must be refused from $state", isOfficeEventAllowed(state, it))
            }
        }
    }

    /** Operations event types have no meaning on an office day. */
    @Test
    fun `site and market punches are never allowed on an office day`() {
        val started = OfficeState.DayStarted("9:30")
        listOf(
            AttendanceType.SITE_IN,
            AttendanceType.SITE_OUT,
            AttendanceType.MARKET_IN,
            AttendanceType.MARKET_OUT,
        ).forEach {
            assertFalse("$it must be refused on an office day", isOfficeEventAllowed(started, it))
        }
    }
}
