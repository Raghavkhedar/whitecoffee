package com.raghav.whitecoffee

import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.deriveAttendanceState
import com.raghav.whitecoffee.data.model.isEventAllowed
import com.raghav.whitecoffee.data.model.willLogoutCloseDay
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

    // ── willLogoutCloseDay: does logging out cost the user the rest of their day? ──
    // Load-bearing: MainViewModel.autoCheckout guards on this, and the home screen's logout
    // confirmation is shown from it. If the two disagreed, the app would either warn about a
    // day it doesn't end, or silently end one it never warned about.

    private fun opsAt(state: AttendanceState) = willLogoutCloseDay(state, emptyList(), isOperations = true, isSales = false)

    @Test fun `ops checked in at a site - logout would close the day`() {
        assertTrue(opsAt(AttendanceState.SiteCheckedIn(event(AttendanceType.SITE_IN))))
    }

    @Test fun `ops at market - logout would close the day`() {
        assertTrue(opsAt(AttendanceState.MarketCheckedIn(event(AttendanceType.MARKET_IN))))
    }

    @Test fun `ops home checked in - logout would close the day`() {
        assertTrue(opsAt(AttendanceState.HomeCheckedIn(event(AttendanceType.HOME_IN))))
    }

    @Test fun `ops with nothing recorded - logout costs nothing`() {
        assertFalse(opsAt(AttendanceState.NoRecord))
    }

    @Test fun `ops already checked out - logout costs nothing`() {
        assertFalse(opsAt(AttendanceState.DayComplete))
    }

    @Test fun `office mid-day - logout would close the day`() {
        // deriveAttendanceState has no office_in branch and reports NoRecord mid-office-day, so
        // the office path must key on the home_in/home_out gates, not the state.
        val events = listOf(event(AttendanceType.HOME_IN), event(AttendanceType.OFFICE_IN))
        assertTrue(willLogoutCloseDay(AttendanceState.NoRecord, events, isOperations = false, isSales = false))
    }

    @Test fun `office who never started the day - logout costs nothing`() {
        assertFalse(willLogoutCloseDay(AttendanceState.NoRecord, emptyList(), isOperations = false, isSales = false))
    }

    @Test fun `office already home out - logout costs nothing`() {
        val events = listOf(event(AttendanceType.HOME_IN), event(AttendanceType.HOME_OUT))
        assertFalse(willLogoutCloseDay(AttendanceState.NoRecord, events, isOperations = false, isSales = false))
    }

    @Test fun `sales at a site takes the ops path, not the office one`() {
        // The bug this guards: inferring sales' open day from the role sends a site-checked-in
        // sales user down the office path, which keys on home gates and would answer false.
        val state = AttendanceState.SiteCheckedIn(event(AttendanceType.SITE_IN))
        assertTrue(willLogoutCloseDay(state, emptyList(), isOperations = false, isSales = true))
    }

    @Test fun `sales on an office day takes the office path`() {
        val events = listOf(event(AttendanceType.HOME_IN), event(AttendanceType.OFFICE_IN))
        assertTrue(willLogoutCloseDay(AttendanceState.NoRecord, events, isOperations = false, isSales = true))
    }
}
