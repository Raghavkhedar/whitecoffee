package com.raghav.whitecoffee

import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.deriveAttendanceState
import com.raghav.whitecoffee.data.model.isEventAllowed
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AttendanceRecordTest {

    private fun event(type: String) = AttendanceRecord(type = type)

    @Test fun `no events is NoRecord`() {
        assertEquals(AttendanceState.NoRecord, deriveAttendanceState(emptyList()))
    }

    @Test fun `home_in is HomeCheckedIn`() {
        val state = deriveAttendanceState(listOf(event(AttendanceType.HOME_IN)))
        assert(state is AttendanceState.HomeCheckedIn)
    }

    @Test fun `home_in then home_out is DayComplete`() {
        val state = deriveAttendanceState(
            listOf(event(AttendanceType.HOME_IN), event(AttendanceType.HOME_OUT))
        )
        assertEquals(AttendanceState.DayComplete, state)
    }

    // --- The bug we're fixing: once home_out has fired, the day must stay closed ---
    @Test fun `site_in recorded after home_out does not reopen the day`() {
        val state = deriveAttendanceState(
            listOf(
                event(AttendanceType.HOME_IN),
                event(AttendanceType.SITE_IN),
                event(AttendanceType.SITE_OUT),
                event(AttendanceType.HOME_OUT),
                event(AttendanceType.SITE_IN), // stray event written after the day was closed
            )
        )
        assertEquals(AttendanceState.DayComplete, state)
    }

    @Test fun `market_in recorded after home_out does not reopen the day`() {
        val state = deriveAttendanceState(
            listOf(
                event(AttendanceType.HOME_IN),
                event(AttendanceType.HOME_OUT),
                event(AttendanceType.MARKET_IN),
            )
        )
        assertEquals(AttendanceState.DayComplete, state)
    }

    // --- isEventAllowed: the write-time guard that stops a stray tap from ever reaching Firestore ---

    @Test fun `site_in is not allowed once the day is complete`() {
        assertFalse(isEventAllowed(AttendanceState.DayComplete, AttendanceType.SITE_IN))
    }

    @Test fun `market_in is not allowed once the day is complete`() {
        assertFalse(isEventAllowed(AttendanceState.DayComplete, AttendanceType.MARKET_IN))
    }

    @Test fun `home_out is not allowed twice in a row`() {
        assertFalse(isEventAllowed(AttendanceState.DayComplete, AttendanceType.HOME_OUT))
    }

    @Test fun `site_in is allowed while home checked in`() {
        assertTrue(isEventAllowed(AttendanceState.HomeCheckedIn(event(AttendanceType.HOME_IN)), AttendanceType.SITE_IN))
    }

    @Test fun `market_in is allowed while checked into a site`() {
        assertTrue(isEventAllowed(AttendanceState.SiteCheckedIn(event(AttendanceType.SITE_IN)), AttendanceType.MARKET_IN))
    }

    @Test fun `site_out is only allowed while checked into a site`() {
        assertTrue(isEventAllowed(AttendanceState.SiteCheckedIn(event(AttendanceType.SITE_IN)), AttendanceType.SITE_OUT))
        assertFalse(isEventAllowed(AttendanceState.HomeCheckedIn(event(AttendanceType.HOME_IN)), AttendanceType.SITE_OUT))
    }
}
