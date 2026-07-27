package com.raghav.whitecoffee.domain

import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceStatusRules
import com.raghav.whitecoffee.data.model.RoleCapabilities
import com.raghav.whitecoffee.data.session.SessionManager
import javax.inject.Inject

/**
 * The live preview of today's attendance verdict, as shown to the employee.
 *
 * [PENDING] and [NOT_CHECKED_IN] both mean "no scoreable arrival", but they are not the same
 * message: an operations day is *scheduled*, so before the first site visit the day genuinely
 * has no verdict yet and may still become a full day. An office day with no `office_in` is
 * simply not started.
 */
enum class DayStatusPreview { PRESENT, SHORT_LEAVE, HALF_DAY, PENDING, NOT_CHECKED_IN }

/**
 * Scores the signed-in user's day the way the nightly `computeDailyAttendanceStatus` will.
 *
 * This is a *preview*, and its value is that it agrees with payroll. When it disagreed, employees
 * saw "Half Day" on a day they were paid in full (or worse, the reverse) and raised tickets
 * nobody could reproduce. It replaces three near-identical role branches on the home screen that
 * each hardwired their own event types — the sales branch being the one that mattered, since a
 * hand-written `OFFICE_IN` filter makes a sales SITE day look like an absence.
 *
 * Role differences now come from [RoleCapabilities] and the shared
 * [AttendanceStatusRules.scorablePunches] scan; the only thing decided here is what a missing
 * arrival means for each role.
 */
class ResolveTodayStatusUseCase @Inject constructor(
    private val sessionManager: SessionManager,
) {

    /**
     * @param plannedWindow the operations user's admin-set shift, or null when none is set.
     *        Ignored for roles scored on the fixed window. A no-plan operations day still scores,
     *        against the default 10:00–18:00 — mirroring the cloud function's fallback rather
     *        than leaving the day unmarked.
     */
    operator fun invoke(
        events: List<AttendanceRecord>,
        plannedWindow: Pair<Int, Int>?,
    ): DayStatusPreview {
        val role = sessionManager.role
        val punches = AttendanceStatusRules.scorablePunches(events, role)

        if (!punches.hasCheckIn) {
            // Operations days are scheduled, so "not at a site yet" is a day awaiting its verdict,
            // not an absence. If they never turn up, the nightly compute decides — not this preview.
            return if (RoleCapabilities.usesFixedWindow(role)) DayStatusPreview.NOT_CHECKED_IN
            else DayStatusPreview.PENDING
        }

        // An arrival with no readable timestamp cannot be scored. Operations keeps waiting;
        // everyone else falls to the conservative bucket rather than claiming Present.
        val inMin = punches.inMinutes
            ?: return if (RoleCapabilities.usesFixedWindow(role)) DayStatusPreview.HALF_DAY
            else DayStatusPreview.PENDING

        val (startMin, endMin) = if (RoleCapabilities.usesFixedWindow(role)) {
            AttendanceStatusRules.OFFICE_START_MIN to AttendanceStatusRules.OFFICE_END_MIN
        } else {
            plannedWindow
                ?: (AttendanceStatusRules.OFFICE_START_MIN to AttendanceStatusRules.OFFICE_END_MIN)
        }

        return when (AttendanceStatusRules.classify(inMin, punches.outMinutes, startMin, endMin)) {
            AttendanceStatusRules.DayStatus.PRESENT     -> DayStatusPreview.PRESENT
            AttendanceStatusRules.DayStatus.SHORT_LEAVE -> DayStatusPreview.SHORT_LEAVE
            AttendanceStatusRules.DayStatus.HALF_DAY    -> DayStatusPreview.HALF_DAY
        }
    }
}
