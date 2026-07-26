package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.domain.toUserMessage
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class OfficeAttendanceViewModel @Inject constructor(
    private val attendanceRepository: AttendanceRepository,
    private val locationProvider: LocationProvider,
    networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    // Office day flow is sequential: Home In → (Office In/Out, repeatable) → Home Out.
    // Home In/Out are once per day, GPS only, and are recorded for data only — they do
    // NOT affect conveyance (ops-only) or attendance_status (office uses office_in/out).
    sealed interface OfficeState {
        data object Loading : OfficeState
        // No home_in yet — day not started.
        data object NotStarted : OfficeState
        // Home In recorded, not currently in an office session.
        data class DayStarted(val homeInTime: String) : OfficeState
        // Currently checked into office. locationName = where they checked in from.
        data class InOffice(val locationName: String, val checkInTime: String) : OfficeState
        // Home Out recorded — day finished.
        data class DayEnded(val homeOutTime: String) : OfficeState
        data class Error(val message: String) : OfficeState
    }

    private val _uiState = MutableStateFlow(OfficeAttendanceUiState())
    val uiState: StateFlow<OfficeAttendanceUiState> = _uiState.asStateFlow()

    private fun setState(state: OfficeState) = _uiState.update { it.copy(day = state) }

    // Double-tap / re-entrancy guard — drops a second tap that arrives before the first write
    // finishes, preventing duplicate office check-in/out docs (stress test #2.1).
    private var isSubmitting = false

    private fun submitEvent(block: suspend () -> Unit) {
        if (isSubmitting) return
        isSubmitting = true
        viewModelScope.launch {
            try {
                block()
            } finally {
                isSubmitting = false
            }
        }
    }

    init {
        loadTodayState()
    }

    fun loadTodayState() {
        viewModelScope.launch {
            setState(OfficeState.Loading)
            val result = attendanceRepository.getTodayData()
            if (result.isFailure) {
                setState(OfficeState.NotStarted)
                return@launch
            }
            val (_, events) = result.getOrThrow()
            // One update: the phase and the timeline it was derived from land together.
            _uiState.value = OfficeAttendanceUiState(deriveOfficeState(events), events)
        }
    }

    // ── Home In — starts the day (GPS only, once per day) ──────────────────
    fun homeIn() = recordSimpleEvent(AttendanceType.HOME_IN, "Home check-in failed. Try again.")

    // ── Home Out — ends the day (GPS only, once per day) ───────────────────
    fun homeOut() = recordSimpleEvent(AttendanceType.HOME_OUT, "Home check-out failed. Try again.")

    // locationName: free-text location the user types before checking in (e.g. "Office", "Client Site ABC")
    fun checkIn(locationName: String) = submitEvent {
        setState(OfficeState.Loading)
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success -> {
                val result = attendanceRepository.recordEvent(
                    type         = AttendanceType.OFFICE_IN,
                    latitude     = location.latitude,
                    longitude    = location.longitude,
                    locationName = locationName.trim()
                )
                handleResult(result, "Check-in failed. Try again.")
            }
            else -> setState(OfficeState.Error(location.toUserMessage()))
        }
    }

    // Records check-out using the same location name as the last check-in
    fun checkOut(locationName: String) = submitEvent {
        setState(OfficeState.Loading)
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success -> {
                val result = attendanceRepository.recordEvent(
                    type         = AttendanceType.OFFICE_OUT,
                    latitude     = location.latitude,
                    longitude    = location.longitude,
                    locationName = locationName
                )
                handleResult(result, "Check-out failed. Try again.")
            }
            else -> setState(OfficeState.Error(location.toUserMessage()))
        }
    }

    // Shared path for GPS-only home events.
    private fun recordSimpleEvent(type: String, failMessage: String) = submitEvent {
        setState(OfficeState.Loading)
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success -> {
                val result = attendanceRepository.recordEvent(
                    type      = type,
                    latitude  = location.latitude,
                    longitude = location.longitude
                )
                handleResult(result, failMessage)
            }
            else -> setState(OfficeState.Error(location.toUserMessage()))
        }
    }

    // Optimistic update: append the new record and re-derive the day state.
    private fun handleResult(result: Result<AttendanceRecord>, failMessage: String) {
        if (result.isSuccess) {
            val updated = _uiState.value.events + result.getOrThrow()
            _uiState.value = OfficeAttendanceUiState(deriveOfficeState(updated), updated)
        } else {
            setState(OfficeState.Error(result.exceptionOrNull()?.message ?: failMessage))
        }
    }

    // Derives the day phase from today's events. Home In/Out are once-per-day gates;
    // office_in/office_out cycle freely between them.
    private fun deriveOfficeState(events: List<AttendanceRecord>): OfficeState {
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
}

/**
 * Everything the office attendance screen renders, as one value.
 *
 * [day] is *derived from* [events], so they must never be published separately — a screen that
 * read the new phase against the old timeline would show a check-in with no matching row.
 */
data class OfficeAttendanceUiState(
    val day: OfficeAttendanceViewModel.OfficeState = OfficeAttendanceViewModel.OfficeState.Loading,
    val events: List<AttendanceRecord> = emptyList(),
)
