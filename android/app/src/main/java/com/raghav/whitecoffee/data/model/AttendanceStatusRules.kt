package com.raghav.whitecoffee.data.model

/**
 * Single source of truth for the client-side daily-status preview shown to
 * employees (home screen + regularization). Mirrors the authoritative cloud
 * function `computeDailyAttendanceStatus`:
 *
 *   offMinutes = late-in + early-out
 *     off == 0   -> Present
 *     off <= 120 -> Short Leave (SL)
 *     else       -> Half Day
 *
 * The on-time cutoff is INCLUSIVE of [startMin]: checking in at exactly 10:00
 * (600) is on time. (The old code compared only the hour with `< 10`, so the
 * whole 10:00–10:59 window was wrongly scored Half Day.)
 *
 * Times are minutes-of-day in the device's local timezone (IST for the field
 * team), matching how attendance is recorded.
 */
object AttendanceStatusRules {
    const val OFFICE_START_MIN = 10 * 60 // 10:00
    const val OFFICE_END_MIN   = 18 * 60 // 18:00
    const val SL_THRESHOLD_MIN = 120     // off-minutes at or below this are SL, above is Half Day

    enum class DayStatus { PRESENT, SHORT_LEAVE, HALF_DAY }

    /**
     * @param inMin  check-in minutes-of-day.
     * @param outMin check-out minutes-of-day, or null when the day is still in
     *               progress (no completed check-out yet) — then only late-in is
     *               scored, since early-out can't be known.
     */
    fun classify(
        inMin: Int,
        outMin: Int?,
        startMin: Int = OFFICE_START_MIN,
        endMin: Int = OFFICE_END_MIN,
    ): DayStatus {
        val late = maxOf(0, inMin - startMin)
        val off = if (outMin == null) late else late + maxOf(0, endMin - outMin)
        return when {
            off == 0 -> DayStatus.PRESENT
            off <= SL_THRESHOLD_MIN -> DayStatus.SHORT_LEAVE
            else -> DayStatus.HALF_DAY
        }
    }
}
