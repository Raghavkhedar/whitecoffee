package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
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

    sealed interface OfficeState {
        data object Loading : OfficeState
        data object NotCheckedIn : OfficeState
        data class CheckedIn(val checkInTime: String) : OfficeState
        data class DayComplete(val checkInTime: String, val checkOutTime: String) : OfficeState
        data class Error(val message: String) : OfficeState
    }

    private val _state = MutableStateFlow<OfficeState>(OfficeState.Loading)
    val state: StateFlow<OfficeState> = _state.asStateFlow()

    init {
        loadTodayState()
    }

    private fun loadTodayState() {
        viewModelScope.launch {
            _state.value = OfficeState.Loading
            val result = attendanceRepository.getTodayEvents()
            if (result.isFailure) {
                _state.value = OfficeState.NotCheckedIn
                return@launch
            }
            val events = result.getOrThrow()
            val checkIn  = events.firstOrNull { it.type == AttendanceType.OFFICE_IN }
            val checkOut = events.firstOrNull { it.type == AttendanceType.OFFICE_OUT }
            _state.value = when {
                checkIn != null && checkOut != null ->
                    OfficeState.DayComplete(checkIn.displayTime(), checkOut.displayTime())
                checkIn != null ->
                    OfficeState.CheckedIn(checkIn.displayTime())
                else ->
                    OfficeState.NotCheckedIn
            }
        }
    }

    fun checkIn() {
        viewModelScope.launch {
            _state.value = OfficeState.Loading
            val location = locationProvider.getCurrentLocation()
            when (location) {
                is LocationState.Success -> {
                    val result = attendanceRepository.recordEvent(
                        type      = AttendanceType.OFFICE_IN,
                        latitude  = location.latitude,
                        longitude = location.longitude
                    )
                    if (result.isSuccess) loadTodayState()
                    else _state.value = OfficeState.Error(
                        result.exceptionOrNull()?.message ?: "Check-in failed. Try again."
                    )
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

    fun checkOut() {
        viewModelScope.launch {
            _state.value = OfficeState.Loading
            val location = locationProvider.getCurrentLocation()
            when (location) {
                is LocationState.Success -> {
                    val result = attendanceRepository.recordEvent(
                        type      = AttendanceType.OFFICE_OUT,
                        latitude  = location.latitude,
                        longitude = location.longitude
                    )
                    if (result.isSuccess) loadTodayState()
                    else _state.value = OfficeState.Error(
                        result.exceptionOrNull()?.message ?: "Check-out failed. Try again."
                    )
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

}
