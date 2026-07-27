package com.raghav.whitecoffee.data.model

/**
 * The office day as a state machine: `NotStarted → DayStarted ⇄ InOffice → DayEnded`.
 *
 * Lives in `data/model` beside [AttendanceState], not inside the ViewModel, for the same reason
 * the operations one does: the rules that read it — [deriveOfficeState], [isOfficeEventAllowed]
 * and `CloseOpenDayUseCase` — are not UI, and while this type was nested in the ViewModel the use
 * case could not reach it and re-implemented the "is an office session open" check from raw events.
 *
 * `home_in`/`home_out` are once-per-day gates, GPS only, recorded for data ONLY — they never feed
 * conveyance (operations + sales) or `attendance_status` (office is scored on office_in/out).
 * `office_in`/`office_out` cycle freely between them.
 */
sealed interface OfficeState {

    data object Loading : OfficeState

    /** No `home_in` yet — day not started. */
    data object NotStarted : OfficeState

    /** `home_in` recorded, not currently in an office session. */
    data class DayStarted(val homeInTime: String) : OfficeState

    /** Currently checked into the office. [locationName] is where they checked in from. */
    data class InOffice(val locationName: String, val checkInTime: String) : OfficeState

    /** `home_out` recorded — day finished, and terminal. */
    data class DayEnded(val homeOutTime: String) : OfficeState

    data class Error(val message: String) : OfficeState
}

/**
 * Derives the office day phase from today's events.
 *
 * `home_out` wins over everything: it is terminal, exactly like `DayComplete` on the operations
 * side. Checked first so a stray later event cannot reopen a finished day.
 */
fun deriveOfficeState(events: List<AttendanceRecord>): OfficeState {
    val homeOut = events.lastOrNull { it.type == AttendanceType.HOME_OUT }
    if (homeOut != null) return OfficeState.DayEnded(homeOut.displayTime())

    val homeIn = events.lastOrNull { it.type == AttendanceType.HOME_IN }
        ?: return OfficeState.NotStarted

    val lastOffice = events.lastOrNull {
        it.type == AttendanceType.OFFICE_IN || it.type == AttendanceType.OFFICE_OUT
    }
    return if (lastOffice?.type == AttendanceType.OFFICE_IN) {
        OfficeState.InOffice(lastOffice.locationName, lastOffice.displayTime())
    } else {
        OfficeState.DayStarted(homeIn.displayTime())
    }
}

/** True when an office session is currently open — i.e. an `office_out` is owed. */
fun hasOpenOfficeSession(events: List<AttendanceRecord>): Boolean =
    deriveOfficeState(events) is OfficeState.InOffice

/**
 * Whether [type] may be written given the current office [state] — the office counterpart of
 * [isEventAllowed].
 *
 * **Checked immediately before the write, not when the button was drawn.** Button visibility is
 * UX, not a guarantee: a check-in button can survive on screen for a frame after `home_out`
 * lands, and the office flow previously had no write-time check at all, so that tap reached
 * Firestore and reopened a finished day. The nightly compute then scores whatever it finds.
 *
 * The rules mirror the buttons documented for each phase:
 *  - `home_in` starts the day, so only from [OfficeState.NotStarted] — once per day.
 *  - `office_in` needs a started day and no open session.
 *  - `office_out` needs an open session.
 *  - `home_out` ends the day, and is refused mid-session: an unclosed `office_in` would leave the
 *    day with no closing punch for payroll to score against.
 *
 * [OfficeState.Loading] and [OfficeState.Error] deny everything — neither is a known day phase,
 * and guessing from an unknown state is how a duplicate punch gets written.
 */
fun isOfficeEventAllowed(state: OfficeState, type: String): Boolean = when (type) {
    AttendanceType.HOME_IN    -> state is OfficeState.NotStarted
    AttendanceType.OFFICE_IN  -> state is OfficeState.DayStarted
    AttendanceType.OFFICE_OUT -> state is OfficeState.InOffice
    AttendanceType.HOME_OUT   -> state is OfficeState.DayStarted
    else                      -> false
}
