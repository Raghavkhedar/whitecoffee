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
}
