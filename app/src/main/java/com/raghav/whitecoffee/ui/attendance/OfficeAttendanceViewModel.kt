package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class OfficeAttendanceViewModel @Inject constructor(
    private val attendanceRepository: AttendanceRepository,
    private val locationProvider: LocationProvider
) : ViewModel() {

    // DayComplete state removed — office users can check in/out multiple times per day.
    sealed interface OfficeState {
        data object Loading : OfficeState
        data object NotCheckedIn : OfficeState
        // locationName: where the user checked in from (free-text entered by user)
        data class CheckedIn(val locationName: String, val checkInTime: String) : OfficeState
        data class Error(val message: String) : OfficeState
    }

    private val _state = MutableStateFlow<OfficeState>(OfficeState.Loading)
    val state: StateFlow<OfficeState> = _state.asStateFlow()

    private val _todayEvents = MutableStateFlow<List<AttendanceRecord>>(emptyList())
    val todayEvents: StateFlow<List<AttendanceRecord>> = _todayEvents.asStateFlow()

    init {
        loadTodayState()
    }

    fun loadTodayState() {
        viewModelScope.launch {
            _state.value = OfficeState.Loading
            val result = attendanceRepository.getTodayData()
            if (result.isFailure) {
                _state.value = OfficeState.NotCheckedIn
                return@launch
            }
            val (_, events) = result.getOrThrow()
            _todayEvents.value = events
            _state.value = deriveOfficeState(events)
        }
    }

    // locationName: free-text location the user types before checking in (e.g. "Office", "Client Site ABC")
    fun checkIn(locationName: String) {
        viewModelScope.launch {
            _state.value = OfficeState.Loading
            val location = locationProvider.getCurrentLocation()
            when (location) {
                is LocationState.Success -> {
                    val result = attendanceRepository.recordEvent(
                        type         = AttendanceType.OFFICE_IN,
                        latitude     = location.latitude,
                        longitude    = location.longitude,
                        locationName = locationName.trim()
                    )
                    if (result.isSuccess) {
                        val newRecord = result.getOrThrow()
                        val updatedEvents = _todayEvents.value + newRecord
                        _todayEvents.value = updatedEvents
                        _state.value = OfficeState.CheckedIn(
                            locationName = newRecord.locationName,
                            checkInTime  = newRecord.displayTime()
                        )
                    } else {
                        _state.value = OfficeState.Error(
                            result.exceptionOrNull()?.message ?: "Check-in failed. Try again."
                        )
                    }
                }
                is LocationState.GpsDisabled ->
                    _state.value = OfficeState.Error("GPS is disabled. Please enable location services.")
                is LocationState.PermissionDenied ->
                    _state.value = OfficeState.Error("Location permission denied.")
                is LocationState.LowAccuracy ->
                    _state.value = OfficeState.Error("Location accuracy too low. Move to open area and try again.")
                is LocationState.Timeout ->
                    _state.value = OfficeState.Error("Location timed out. Try again.")
            }
        }
    }

    // Records check-out using the same location name as the last check-in
    fun checkOut(locationName: String) {
        viewModelScope.launch {
            _state.value = OfficeState.Loading
            val location = locationProvider.getCurrentLocation()
            when (location) {
                is LocationState.Success -> {
                    val result = attendanceRepository.recordEvent(
                        type         = AttendanceType.OFFICE_OUT,
                        latitude     = location.latitude,
                        longitude    = location.longitude,
                        locationName = locationName
                    )
                    if (result.isSuccess) {
                        val updatedEvents = _todayEvents.value + result.getOrThrow()
                        _todayEvents.value = updatedEvents
                        _state.value = OfficeState.NotCheckedIn
                    } else {
                        _state.value = OfficeState.Error(
                            result.exceptionOrNull()?.message ?: "Check-out failed. Try again."
                        )
                    }
                }
                is LocationState.GpsDisabled ->
                    _state.value = OfficeState.Error("GPS is disabled. Please enable location services.")
                is LocationState.PermissionDenied ->
                    _state.value = OfficeState.Error("Location permission denied.")
                is LocationState.LowAccuracy ->
                    _state.value = OfficeState.Error("Location accuracy too low. Try again.")
                is LocationState.Timeout ->
                    _state.value = OfficeState.Error("Location timed out. Try again.")
            }
        }
    }

    private fun deriveOfficeState(events: List<AttendanceRecord>): OfficeState {
        val lastEvent = events.lastOrNull()
        return if (lastEvent?.type == AttendanceType.OFFICE_IN) {
            OfficeState.CheckedIn(
                locationName = lastEvent.locationName,
                checkInTime  = lastEvent.displayTime()
            )
        } else {
            OfficeState.NotCheckedIn
        }
    }
}
