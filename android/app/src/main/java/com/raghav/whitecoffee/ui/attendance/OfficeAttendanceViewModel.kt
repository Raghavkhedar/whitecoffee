package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.OfficeState
import com.raghav.whitecoffee.data.model.deriveOfficeState
import com.raghav.whitecoffee.data.model.isOfficeEventAllowed
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

    private val _uiState = MutableStateFlow(OfficeAttendanceUiState())
    val uiState: StateFlow<OfficeAttendanceUiState> = _uiState.asStateFlow()

    private fun setState(state: OfficeState) = _uiState.update { it.copy(day = state) }

    /**
     * Write-time legality check, run immediately before every office write.
     *
     * The operations flow has always had this; the office flow had nothing, so a stale button —
     * or a tap landing in the frame after `home_out` — wrote straight to Firestore and reopened a
     * finished day. Checking here rather than at render time is the point: the buttons are UX,
     * this is the guarantee.
     *
     * The current phase is re-derived from the events rather than read from [_uiState] so a
     * transient Loading/Error state cannot mask the real one and wave a punch through.
     */
    private fun guard(type: String): Boolean {
        val state = deriveOfficeState(_uiState.value.events)
        if (isOfficeEventAllowed(state, type)) return true
        setState(
            OfficeState.Error(
                when {
                    state is OfficeState.DayEnded -> "Your day is already complete."
                    type == AttendanceType.HOME_OUT && state is OfficeState.InOffice ->
                        "Check out of the office before ending your day."
                    else -> "That action isn't available right now. Pull down to refresh."
                }
            )
        )
        return false
    }

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
        if (!guard(AttendanceType.OFFICE_IN)) return@submitEvent
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
        if (!guard(AttendanceType.OFFICE_OUT)) return@submitEvent
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
        if (!guard(type)) return@submitEvent
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

}

/**
 * Everything the office attendance screen renders, as one value.
 *
 * [day] is *derived from* [events], so they must never be published separately — a screen that
 * read the new phase against the old timeline would show a check-in with no matching row.
 */
data class OfficeAttendanceUiState(
    val day: OfficeState = OfficeState.Loading,
    val events: List<AttendanceRecord> = emptyList(),
)
