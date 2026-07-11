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
 *
 * Scoring window by role, matching the cloud function:
 *  - office/admin: fixed [OFFICE_START_MIN]–[OFFICE_END_MIN], scored on office_in/office_out.
 *  - operations:   the day's admin-set planned shift (see [resolveOpsWindow]), scored on the
 *    first site_in/market_in and the last site_out/market_out. With no planned shift the cloud
 *    leaves the day unmarked — the client preview shows a neutral "pending" instead of guessing.
 */
object AttendanceStatusRules {
    const val OFFICE_START_MIN = 10 * 60 // 10:00
    const val OFFICE_END_MIN   = 18 * 60 // 18:00
    const val SL_THRESHOLD_MIN = 120     // off-minutes at or below this are SL, above is Half Day

    enum class DayStatus { PRESENT, SHORT_LEAVE, HALF_DAY }

    /** Parse a "HH:MM" 24h string into minutes-from-midnight; [fallback] if null/blank/malformed. */
    fun hhmmToMinutes(hhmm: String?, fallback: Int): Int {
        if (hhmm.isNullOrBlank()) return fallback
        val parts = hhmm.split(":")
        val h = parts.getOrNull(0)?.trim()?.toIntOrNull()
        val m = parts.getOrNull(1)?.trim()?.toIntOrNull()
        if (h == null || m == null) return fallback
        return h * 60 + m
    }

    /**
     * Resolve an operations user's planned shift into a scoring window, mirroring
     * `computeDailyAttendanceStatus`:
     *  - null            → no usable plan (both times must be set); payroll leaves the day
     *                      unmarked, so the preview shows "pending" rather than a verdict.
     *  - (startMin,endMin) otherwise, falling back to [OFFICE_START_MIN]–[OFFICE_END_MIN] for an
     *                      inverted/zero window (e.g. a mis-entered end before start).
     */
    fun resolveOpsWindow(startTime: String?, endTime: String?): Pair<Int, Int>? {
        if (startTime.isNullOrBlank() || endTime.isNullOrBlank()) return null
        var startMin = hhmmToMinutes(startTime, OFFICE_START_MIN)
        var endMin   = hhmmToMinutes(endTime, OFFICE_END_MIN)
        if (endMin <= startMin) { startMin = OFFICE_START_MIN; endMin = OFFICE_END_MIN }
        return startMin to endMin
    }

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
