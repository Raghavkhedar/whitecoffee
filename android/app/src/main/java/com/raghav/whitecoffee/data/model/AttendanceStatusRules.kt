package com.raghav.whitecoffee.data.model

/**
 * Single source of truth for the client-side daily-status preview shown to
 * employees (home screen + regularization). Mirrors the authoritative cloud
 * function `computeDailyAttendanceStatus`, whose scoring rule lives in
 * firebase/functions/attendanceRules.js — keep the rule and planned-window
 * fallback in sync across both files (and both test suites:
 * AttendanceStatusRulesTest.kt here, attendanceRules.test.js there):
 *
 *   late-in > 0                 -> Half Day (any lateness at all, however small)
 *   early-out > 0 (no late-in)  -> Short Leave (SL)
 *   neither                     -> Present
 *
 * When both are present, Half Day wins — it's graded first and short-circuits.
 *
 * The on-time cutoff is INCLUSIVE of [startMin]: checking in at exactly 10:00
 * (600) is on time. (The old code compared only the hour with `< 10`, so the
 * whole 10:00–10:59 window was wrongly scored Half Day.)
 *
 * Times are minutes-of-day in the device's local timezone (IST for the field
 * team), matching how attendance is recorded.
 *
 * Scoring window by role, matching the cloud function (the event source per role comes from
 * [RoleCapabilities], keep both in lockstep):
 *  - office/admin: fixed [OFFICE_START_MIN]–[OFFICE_END_MIN], scored on office_in/office_out.
 *  - sales:        fixed [OFFICE_START_MIN]–[OFFICE_END_MIN] (same buckets as office), but scored
 *    on the first check-in of ANY type and the last check-out of ANY type — the hybrid role may do
 *    an office day (office_in/out) OR a site day (site_in/out, market_in/out). No OT/shortage.
 *  - operations:   the day's admin-set planned shift (see [resolveOpsWindow]), scored on the
 *    first site_in/market_in and the last site_out/market_out. With NO planned shift a worked
 *    day still scores, against the default [OFFICE_START_MIN]–[OFFICE_END_MIN] — mirroring the
 *    cloud's window fallback and the portal's otLedger DEFAULT_SHIFT_*_MIN.
 */
object AttendanceStatusRules {
    const val OFFICE_START_MIN = 10 * 60 // 10:00
    const val OFFICE_END_MIN   = 18 * 60 // 18:00

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
     *  - null            → no usable plan (both times must be set). Callers score a worked day
     *                      against the default [OFFICE_START_MIN]–[OFFICE_END_MIN] window; this
     *                      function stays honest about the plan being absent rather than baking
     *                      the policy in (the JS side defaults at the call site too).
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
        val earlyOut = if (outMin == null) 0 else maxOf(0, endMin - outMin)
        return when {
            late > 0 -> DayStatus.HALF_DAY
            earlyOut > 0 -> DayStatus.SHORT_LEAVE
            else -> DayStatus.PRESENT
        }
    }

    /**
     * The two punches [classify] scores for a day, reduced to minutes-of-day.
     *
     * The three null/false cases mean different things and callers act on them differently:
     *  - `!hasCheckIn`          — no scoreable arrival at all. Whether that is "not checked in
     *                             yet" or "pending, they may still turn up" is the caller's
     *                             policy, not this function's.
     *  - `inMinutes == null`    — an arrival exists but carries no readable timestamp.
     *  - `outMinutes == null`   — the day is still in progress; only late-in can be scored.
     */
    data class ScoredPunches(
        val inMinutes: Int?,
        val outMinutes: Int?,
        val hasCheckIn: Boolean,
    )

    /**
     * Extracts the punches payroll scores for [role] from a day's events.
     *
     * Event types come from [RoleCapabilities], so a role's scoring source is defined in exactly
     * one place — this used to be open-coded four times (three role branches on the home screen
     * plus regularization), each hardwiring its own in/out constants. The sales column is the
     * reason that mattered: a hand-written `OFFICE_IN` branch makes a sales SITE day invisible.
     *
     * A check-out only counts when it is *after* the last check-in. Someone who checked out of
     * one site and into another is still working, and scoring that intermediate departure as the
     * end of their day would dock them for an early-out they never took.
     */
    fun scorablePunches(events: List<AttendanceRecord>, role: String): ScoredPunches {
        val inTypes  = RoleCapabilities.attendanceInTypes(role).toSet()
        val outTypes = RoleCapabilities.attendanceOutTypes(role).toSet()

        val firstIn = events.firstOrNull { it.type in inTypes }
            ?: return ScoredPunches(inMinutes = null, outMinutes = null, hasCheckIn = false)

        val lastInIdx  = events.indexOfLast { it.type in inTypes }
        val lastOutIdx = events.indexOfLast { it.type in outTypes }
        val lastOut    = if (lastOutIdx > lastInIdx) events[lastOutIdx] else null

        return ScoredPunches(
            inMinutes  = minutesOfDay(firstIn),
            outMinutes = lastOut?.let { minutesOfDay(it) },
            hasCheckIn = true,
        )
    }

    /** Minutes from midnight in the device's local timezone, or null if the event has no time. */
    fun minutesOfDay(record: AttendanceRecord): Int? {
        val date = record.timestamp?.toDate() ?: return null
        val cal = java.util.Calendar.getInstance().apply { time = date }
        return cal.get(java.util.Calendar.HOUR_OF_DAY) * 60 + cal.get(java.util.Calendar.MINUTE)
    }
}
