package com.raghav.whitecoffee

import com.raghav.whitecoffee.data.model.AttendanceStatusRules
import com.raghav.whitecoffee.data.model.AttendanceStatusRules.DayStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class AttendanceStatusRulesTest {

    private fun m(h: Int, min: Int = 0) = h * 60 + min

    // --- The bug we're fixing: 10:00 login must NOT be Half Day ---
    @Test fun `checkin at exactly 10 00 with full day is Present`() {
        assertEquals(DayStatus.PRESENT, AttendanceStatusRules.classify(m(10, 0), m(18, 0)))
    }

    @Test fun `checkin at exactly 10 00 still in progress is Present`() {
        assertEquals(DayStatus.PRESENT, AttendanceStatusRules.classify(m(10, 0), null))
    }

    @Test fun `checkin before 10 is Present`() {
        assertEquals(DayStatus.PRESENT, AttendanceStatusRules.classify(m(9, 45), m(18, 0)))
    }

    // --- Late-in grades into SL, then Half Day at >120 min ---
    @Test fun `one minute late is Short Leave not Half Day`() {
        assertEquals(DayStatus.SHORT_LEAVE, AttendanceStatusRules.classify(m(10, 1), m(18, 0)))
    }

    @Test fun `checkin at 10 45 is Short Leave`() {
        assertEquals(DayStatus.SHORT_LEAVE, AttendanceStatusRules.classify(m(10, 45), m(18, 0)))
    }

    @Test fun `exactly 120 off-minutes is Short Leave`() {
        assertEquals(DayStatus.SHORT_LEAVE, AttendanceStatusRules.classify(m(12, 0), m(18, 0)))
    }

    @Test fun `121 off-minutes is Half Day`() {
        assertEquals(DayStatus.HALF_DAY, AttendanceStatusRules.classify(m(12, 1), m(18, 0)))
    }

    // --- Early-out is scored too (only when a checkout exists) ---
    @Test fun `early out by 30 min is Short Leave`() {
        assertEquals(DayStatus.SHORT_LEAVE, AttendanceStatusRules.classify(m(10, 0), m(17, 30)))
    }

    @Test fun `early out by 3 hours is Half Day`() {
        assertEquals(DayStatus.HALF_DAY, AttendanceStatusRules.classify(m(10, 0), m(15, 0)))
    }

    @Test fun `late in plus early out combine past threshold`() {
        // 60 late + 61 early = 121 off -> Half Day
        assertEquals(DayStatus.HALF_DAY, AttendanceStatusRules.classify(m(11, 0), m(16, 59)))
    }

    @Test fun `in progress ignores unknown checkout`() {
        // 15 min late, no checkout yet -> SL from late-in alone
        assertEquals(DayStatus.SHORT_LEAVE, AttendanceStatusRules.classify(m(10, 15), null))
    }

    // --- Operations planned window scoring (custom start/end) ---
    @Test fun `ops on-time against a 12 to 20 planned shift is Present`() {
        // Arrive 12:00, leave 20:00 against a noon–8pm shift -> Present (would be Half Day vs 10–18)
        assertEquals(DayStatus.PRESENT, AttendanceStatusRules.classify(m(12, 0), m(20, 0), m(12, 0), m(20, 0)))
    }

    @Test fun `ops late against planned shift grades to SL`() {
        assertEquals(DayStatus.SHORT_LEAVE, AttendanceStatusRules.classify(m(12, 30), m(20, 0), m(12, 0), m(20, 0)))
    }

    // --- hhmmToMinutes ---
    @Test fun `hhmm parses valid time`() {
        assertEquals(m(14, 30), AttendanceStatusRules.hhmmToMinutes("14:30", 0))
    }

    @Test fun `hhmm falls back on null blank or malformed`() {
        assertEquals(600, AttendanceStatusRules.hhmmToMinutes(null, 600))
        assertEquals(600, AttendanceStatusRules.hhmmToMinutes("", 600))
        assertEquals(600, AttendanceStatusRules.hhmmToMinutes("garbage", 600))
    }

    // --- resolveOpsWindow ---
    @Test fun `resolveOpsWindow returns null when either time missing`() {
        assertEquals(null, AttendanceStatusRules.resolveOpsWindow(null, "18:00"))
        assertEquals(null, AttendanceStatusRules.resolveOpsWindow("10:00", ""))
    }

    @Test fun `resolveOpsWindow returns parsed window`() {
        assertEquals(m(12, 0) to m(20, 0), AttendanceStatusRules.resolveOpsWindow("12:00", "20:00"))
    }

    @Test fun `resolveOpsWindow falls back to 10 to 18 for inverted window`() {
        assertEquals(m(10, 0) to m(18, 0), AttendanceStatusRules.resolveOpsWindow("20:00", "12:00"))
    }
}
