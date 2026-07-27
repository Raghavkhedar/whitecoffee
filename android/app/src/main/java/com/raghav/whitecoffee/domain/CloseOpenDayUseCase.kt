package com.raghav.whitecoffee.domain

import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.DayClosePath
import com.raghav.whitecoffee.data.model.OfficeState
import com.raghav.whitecoffee.data.model.deriveOfficeState
import com.raghav.whitecoffee.data.model.dayClosePath
import com.raghav.whitecoffee.data.model.willLogoutCloseDay
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.session.SessionManager
import javax.inject.Inject

/**
 * What a close-the-open-day attempt actually did. Returned rather than swallowed so callers —
 * and tests — can tell "nothing needed closing" apart from "we could not close it".
 */
sealed interface CloseDayOutcome {

    /** No open day, so nothing was written. The common case: most logouts close nothing. */
    data object NothingOpen : CloseDayOutcome

    /** Today's attendance could not be read, so we cannot know what to close. */
    data object Unknown : CloseDayOutcome

    /** A day was open but no GPS fix was available; every event needs coordinates. */
    data object NoLocation : CloseDayOutcome

    /** The day was closed. [written] lists the event types in the order they were recorded. */
    data class Closed(val path: DayClosePath, val written: List<String>) : CloseDayOutcome
}

/**
 * Closes whatever attendance day is still open, so signing out cannot leave a dangling check-in.
 *
 * **Why this exists as its own type.** An unclosed `site_in` is scored by the nightly compute as
 * LNF — half a day's pay — so this is one of the few code paths in the app where a branch is
 * worth real money. It previously lived inside `MainViewModel` alongside session monitoring,
 * which meant it could not be constructed on a JVM test runner and went untested.
 *
 * The dispatch between the field and office paths is [dayClosePath], shared with the
 * confirmation dialog so the warning and the write can never disagree.
 *
 * Callers are expected to proceed with logout regardless of the outcome — see the note on
 * failure handling in `MainViewModel.logoutWithAutoCheckout`. Being unable to close the day is
 * not a reason to trap someone in a signed-in session.
 */
class CloseOpenDayUseCase @Inject constructor(
    private val attendanceRepository: AttendanceRepository,
    private val locationProvider: LocationProvider,
    private val sessionManager: SessionManager,
) {

    suspend operator fun invoke(): CloseDayOutcome {
        val result = attendanceRepository.getTodayData()
        if (result.isFailure) return CloseDayOutcome.Unknown
        val (state, events) = result.getOrThrow()

        val isOperations = sessionManager.isOperations
        val isSales = sessionManager.isSales

        if (!willLogoutCloseDay(state, events, isOperations, isSales)) return CloseDayOutcome.NothingOpen

        val location = locationProvider.getCurrentLocation()
        if (location !is LocationState.Success) return CloseDayOutcome.NoLocation

        return when (val path = dayClosePath(state, isOperations, isSales)) {
            DayClosePath.FIELD  -> CloseDayOutcome.Closed(path, closeFieldDay(state, location))
            DayClosePath.OFFICE -> CloseDayOutcome.Closed(path, closeOfficeDay(events, location))
        }
    }

    /**
     * Field day: close the open site/market visit, then the commute. Both events are needed —
     * the visit pair is what payroll scores, and `home_out` is what marks the day terminal.
     */
    private suspend fun closeFieldDay(
        state: AttendanceState,
        loc: LocationState.Success,
    ): List<String> = when (state) {
        is AttendanceState.SiteCheckedIn -> {
            record(AttendanceType.SITE_OUT, loc, siteId = state.record.siteId, siteName = state.record.siteName)
            record(AttendanceType.HOME_OUT, loc)
            listOf(AttendanceType.SITE_OUT, AttendanceType.HOME_OUT)
        }
        is AttendanceState.MarketCheckedIn -> {
            record(AttendanceType.MARKET_OUT, loc, marketName = state.record.marketName)
            record(AttendanceType.HOME_OUT, loc)
            listOf(AttendanceType.MARKET_OUT, AttendanceType.HOME_OUT)
        }
        is AttendanceState.HomeCheckedIn -> {
            record(AttendanceType.HOME_OUT, loc)
            listOf(AttendanceType.HOME_OUT)
        }
        // Guarded by willLogoutCloseDay above; NoRecord and DayComplete never reach here.
        else -> emptyList()
    }

    /**
     * Office day: close the office session if one is open, then the commute.
     *
     * Keys on the raw events rather than [AttendanceState] because `deriveAttendanceState` has
     * no branch for office_in/office_out and reports `NoRecord` mid-office-day. The office phase
     * comes from the shared [deriveOfficeState] — this used to re-implement that check inline,
     * which is exactly the kind of second copy that lets the two answers drift.
     */
    private suspend fun closeOfficeDay(
        events: List<AttendanceRecord>,
        loc: LocationState.Success,
    ): List<String> {
        val written = mutableListOf<String>()

        val open = deriveOfficeState(events) as? OfficeState.InOffice
        if (open != null) {
            record(AttendanceType.OFFICE_OUT, loc, locationName = open.locationName)
            written += AttendanceType.OFFICE_OUT
        }
        record(AttendanceType.HOME_OUT, loc)
        written += AttendanceType.HOME_OUT
        return written
    }

    private suspend fun record(
        type: String,
        loc: LocationState.Success,
        siteId: String = "",
        siteName: String = "",
        marketName: String = "",
        locationName: String = "",
    ) = attendanceRepository.recordEvent(
        type = type,
        latitude = loc.latitude,
        longitude = loc.longitude,
        siteId = siteId,
        siteName = siteName,
        marketName = marketName,
        locationName = locationName,
    )
}
