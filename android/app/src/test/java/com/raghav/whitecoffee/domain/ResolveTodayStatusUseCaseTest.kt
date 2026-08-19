package com.raghav.whitecoffee.domain

import com.google.firebase.Timestamp
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.session.SessionManager
import com.raghav.whitecoffee.fake.FakeSessionManager
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Calendar

/**
 * The live daily-status preview.
 *
 * Its only job is to agree with the nightly `computeDailyAttendanceStatus`. When it disagreed,
 * employees saw a verdict on the home screen that payroll then contradicted — the kind of bug
 * that arrives as a complaint rather than a crash. The sales cases are the ones that used to be
 * wrong: a hand-written `office_in` filter makes a sales SITE day look like an absence.
 */
class ResolveTodayStatusUseCaseTest {

    /** An event at local [hour]:[minute] — the same clock the scoring window is expressed in. */
    private fun at(hour: Int, minute: Int, type: String): AttendanceRecord {
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }
        return AttendanceRecord(id = "e", userId = "u1", type = type, timestamp = Timestamp(cal.time))
    }

    private fun resolve(
        role: String,
        events: List<AttendanceRecord>,
        plannedWindow: Pair<Int, Int>? = null,
    ) = ResolveTodayStatusUseCase(FakeSessionManager(role = role))(events, plannedWindow)

    // ── Office: fixed 10:00–18:00 ─────────────────────────────────────────

    @Test
    fun `office on time and full day is Present`() {
        val events = listOf(at(10, 0, AttendanceType.OFFICE_IN), at(18, 0, AttendanceType.OFFICE_OUT))
        assertEquals(DayStatusPreview.PRESENT, resolve(SessionManager.ROLE_OFFICE, events))
    }

    @Test
    fun `checking in at exactly 10 00 is on time, not late`() {
        // Regression: the old hour-granular check scored the whole 10:00 hour as Half Day.
        val events = listOf(at(10, 0, AttendanceType.OFFICE_IN))
        assertEquals(DayStatusPreview.PRESENT, resolve(SessionManager.ROLE_OFFICE, events))
    }

    @Test
    fun `office two hours late is Half Day`() {
        val events = listOf(at(12, 0, AttendanceType.OFFICE_IN), at(18, 0, AttendanceType.OFFICE_OUT))
        assertEquals(DayStatusPreview.HALF_DAY, resolve(SessionManager.ROLE_OFFICE, events))
    }

    @Test
    fun `office more than two hours off is Half Day`() {
        val events = listOf(at(13, 0, AttendanceType.OFFICE_IN), at(18, 0, AttendanceType.OFFICE_OUT))
        assertEquals(DayStatusPreview.HALF_DAY, resolve(SessionManager.ROLE_OFFICE, events))
    }

    @Test
    fun `office with no office_in is Not Checked In`() {
        val events = listOf(at(9, 0, AttendanceType.HOME_IN))
        assertEquals(DayStatusPreview.NOT_CHECKED_IN, resolve(SessionManager.ROLE_OFFICE, events))
    }

    @Test
    fun `a re-entry means the day is still in progress, not an early out`() {
        // Left one office session and started another: the intermediate departure must not be
        // scored as the end of the day, or they are docked for an early-out they never took.
        val events = listOf(
            at(10, 0, AttendanceType.OFFICE_IN),
            at(13, 0, AttendanceType.OFFICE_OUT),
            at(14, 0, AttendanceType.OFFICE_IN),
        )
        assertEquals(DayStatusPreview.PRESENT, resolve(SessionManager.ROLE_OFFICE, events))
    }

    // ── Operations: planned shift, PENDING before arrival ─────────────────

    @Test
    fun `ops before reaching any site is Pending, not Absent`() {
        val events = listOf(at(8, 0, AttendanceType.HOME_IN))
        assertEquals(DayStatusPreview.PENDING, resolve(SessionManager.ROLE_OPERATIONS, events))
    }

    @Test
    fun `ops is scored against the planned shift`() {
        val events = listOf(at(8, 0, AttendanceType.SITE_IN), at(16, 0, AttendanceType.SITE_OUT))
        assertEquals(
            DayStatusPreview.PRESENT,
            resolve(SessionManager.ROLE_OPERATIONS, events, plannedWindow = 8 * 60 to 16 * 60)
        )
    }

    @Test
    fun `ops with no plan falls back to the default window rather than going unmarked`() {
        val events = listOf(at(10, 0, AttendanceType.SITE_IN), at(18, 0, AttendanceType.SITE_OUT))
        assertEquals(DayStatusPreview.PRESENT, resolve(SessionManager.ROLE_OPERATIONS, events))
    }

    @Test
    fun `ops home events alone never score the day`() {
        // home_in/home_out are commute markers; scoring them would pay for the drive.
        val events = listOf(at(8, 0, AttendanceType.HOME_IN), at(19, 0, AttendanceType.HOME_OUT))
        assertEquals(DayStatusPreview.PENDING, resolve(SessionManager.ROLE_OPERATIONS, events))
    }

    // ── Sales: the hybrid ─────────────────────────────────────────────────

    @Test
    fun `a sales site day is scored, not treated as an absence`() {
        val events = listOf(at(10, 0, AttendanceType.SITE_IN), at(18, 0, AttendanceType.SITE_OUT))
        assertEquals(DayStatusPreview.PRESENT, resolve(SessionManager.ROLE_SALES, events))
    }

    @Test
    fun `a sales office day is scored on the same fixed window`() {
        val events = listOf(at(10, 0, AttendanceType.OFFICE_IN), at(18, 0, AttendanceType.OFFICE_OUT))
        assertEquals(DayStatusPreview.PRESENT, resolve(SessionManager.ROLE_SALES, events))
    }

    @Test
    fun `sales mixing office and site counts the first in and last out across both`() {
        val events = listOf(
            at(10, 0, AttendanceType.OFFICE_IN),
            at(12, 0, AttendanceType.OFFICE_OUT),
            at(13, 0, AttendanceType.SITE_IN),
            at(18, 0, AttendanceType.SITE_OUT),
        )
        assertEquals(DayStatusPreview.PRESENT, resolve(SessionManager.ROLE_SALES, events))
    }

    @Test
    fun `sales ignores a planned window even when one is supplied`() {
        // Sales is a fixed-window role and never needs a plan; honouring one would score it
        // as operations.
        val events = listOf(at(8, 0, AttendanceType.SITE_IN), at(16, 0, AttendanceType.SITE_OUT))
        assertEquals(
            DayStatusPreview.SHORT_LEAVE,
            resolve(SessionManager.ROLE_SALES, events, plannedWindow = 8 * 60 to 16 * 60)
        )
    }
}
