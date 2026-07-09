package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
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

    private val _state = MutableStateFlow<OfficeState>(OfficeState.Loading)
    val state: StateFlow<OfficeState> = _state.asStateFlow()

    private val _todayEvents = MutableStateFlow<List<AttendanceRecord>>(emptyList())
    val todayEvents: StateFlow<List<AttendanceRecord>> = _todayEvents.asStateFlow()

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
            _state.value = OfficeState.Loading
            val result = attendanceRepository.getTodayData()
            if (result.isFailure) {
                _state.value = OfficeState.NotStarted
                return@launch
            }
            val (_, events) = result.getOrThrow()
            _todayEvents.value = events
            _state.value = deriveOfficeState(events)
        }
    }

    // ── Home In — starts the day (GPS only, once per day) ──────────────────
    fun homeIn() = recordSimpleEvent(AttendanceType.HOME_IN, "Home check-in failed. Try again.")

    // ── Home Out — ends the day (GPS only, once per day) ───────────────────
    fun homeOut() = recordSimpleEvent(AttendanceType.HOME_OUT, "Home check-out failed. Try again.")

    // locationName: free-text location the user types before checking in (e.g. "Office", "Client Site ABC")
    fun checkIn(locationName: String) = submitEvent {
        _state.value = OfficeState.Loading
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
            else -> _state.value = OfficeState.Error(location.toMessage())
        }
    }

    // Records check-out using the same location name as the last check-in
    fun checkOut(locationName: String) = submitEvent {
        _state.value = OfficeState.Loading
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
            else -> _state.value = OfficeState.Error(location.toMessage())
        }
    }

    // Shared path for GPS-only home events.
    private fun recordSimpleEvent(type: String, failMessage: String) = submitEvent {
        _state.value = OfficeState.Loading
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success -> {
                val result = attendanceRepository.recordEvent(
                    type      = type,
                    latitude  = location.latitude,
                    longitude = location.longitude
                )
                handleResult(result, failMessage)
            }
            else -> _state.value = OfficeState.Error(location.toMessage())
        }
    }

    // Optimistic update: append the new record and re-derive the day state.
    private fun handleResult(result: Result<AttendanceRecord>, failMessage: String) {
        if (result.isSuccess) {
            val updated = _todayEvents.value + result.getOrThrow()
            _todayEvents.value = updated
            _state.value = deriveOfficeState(updated)
        } else {
            _state.value = OfficeState.Error(result.exceptionOrNull()?.message ?: failMessage)
        }
    }

    private fun LocationState.toMessage(): String = when (this) {
        is LocationState.GpsDisabled     -> "GPS is disabled. Please enable location services."
        is LocationState.PermissionDenied -> "Location permission denied."
        is LocationState.LowAccuracy     -> "Location accuracy too low. Move to open area and try again."
        is LocationState.Timeout         -> "Location timed out. Try again."
        is LocationState.Success         -> ""
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
