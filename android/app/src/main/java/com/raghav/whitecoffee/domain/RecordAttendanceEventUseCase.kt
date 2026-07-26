package com.raghav.whitecoffee.domain

import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.isEventAllowed
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import javax.inject.Inject

/** What happened when the app tried to record one attendance punch. */
sealed interface RecordEventOutcome {

    data class Recorded(val record: AttendanceRecord) : RecordEventOutcome

    /**
     * The punch was refused before any write. [dayAlreadyComplete] separates the one case worth
     * its own message — a day that is over stays over — from a generally stale button.
     */
    data class NotAllowed(val dayAlreadyComplete: Boolean) : RecordEventOutcome

    /** No usable GPS fix. [state] is the specific reason, for the message shown to the user. */
    data class NoLocation(val state: LocationState) : RecordEventOutcome

    /** The write itself failed. */
    data class Failed(val error: Throwable) : RecordEventOutcome
}

/**
 * Records one attendance punch: legality check, GPS fix, write.
 *
 * Every punch in the app followed those three steps, open-coded at seven call sites across the
 * two attendance ViewModels — each repeating the same five-branch `when` over [LocationState].
 * Seven copies of a guard is seven chances for one of them to drift, and this particular guard
 * is what stops an out-of-order tap from reaching Firestore at all (rather than merely failing
 * to render afterwards).
 *
 * The check runs immediately before the write, not when the button was drawn: a check-in button
 * can survive on screen for a frame after `home_out` lands, and the tap that follows must not
 * reopen a closed day.
 */
class RecordAttendanceEventUseCase @Inject constructor(
    private val attendanceRepository: AttendanceRepository,
    private val locationProvider: LocationProvider,
) {

    suspend operator fun invoke(
        state: AttendanceState,
        type: String,
        siteId: String = "",
        siteName: String = "",
        marketName: String = "",
        locationName: String = "",
    ): RecordEventOutcome {
        if (!isEventAllowed(state, type)) {
            return RecordEventOutcome.NotAllowed(
                dayAlreadyComplete = state is AttendanceState.DayComplete
            )
        }

        val location = locationProvider.getCurrentLocation()
        if (location !is LocationState.Success) return RecordEventOutcome.NoLocation(location)

        return attendanceRepository.recordEvent(
            type = type,
            latitude = location.latitude,
            longitude = location.longitude,
            siteId = siteId,
            siteName = siteName,
            marketName = marketName,
            locationName = locationName,
        ).fold(
            onSuccess = { RecordEventOutcome.Recorded(it) },
            onFailure = { RecordEventOutcome.Failed(it) },
        )
    }
}

/**
 * The message shown when a fix could not be obtained. Lives here so all seven former call sites
 * word it identically — users compare notes, and two spellings of the same failure read as two
 * different bugs.
 */
fun LocationState.toUserMessage(): String = when (this) {
    is LocationState.Success -> ""
    LocationState.GpsDisabled -> "GPS is disabled. Please enable location services."
    LocationState.PermissionDenied -> "Location permission denied."
    LocationState.LowAccuracy -> "Location accuracy too low. Move to open area and try again."
    LocationState.Timeout -> "Location timed out. Try again."
}
