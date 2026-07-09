package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.deriveAttendanceState
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

// SiteRepository + SiteTask imports removed — daily assignment system commented out.
// To re-enable: import SiteRepository, SiteTask; restore _assignedSites, loadSites(),
// ActionState.SiteSelectionRequired, initiateSiteCheckIn() site-picker logic,
// confirmSiteCheckIn(SiteTask) with Haversine geofence check, and getTaskForSite().

@HiltViewModel
class AttendanceViewModel @Inject constructor(
    private val attendanceRepository: AttendanceRepository,
    private val locationProvider: LocationProvider,
    private val sessionManager: SessionManager,
    networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    private val _attendanceState = MutableStateFlow<UiState<AttendanceState>>(UiState.Loading())
    val attendanceState: StateFlow<UiState<AttendanceState>> = _attendanceState.asStateFlow()

    private val _todayEvents = MutableStateFlow<List<AttendanceRecord>>(emptyList())
    val todayEvents: StateFlow<List<AttendanceRecord>> = _todayEvents.asStateFlow()

    private val _actionState = MutableStateFlow<ActionState>(ActionState.Idle)
    val actionState: StateFlow<ActionState> = _actionState.asStateFlow()

    val isOperations: Boolean get() = sessionManager.isOperations

    // Double-tap / re-entrancy guard. ViewModel methods are called on the main thread, so a plain
    // flag is race-free here: a second tap arriving before the first write finishes is dropped,
    // preventing duplicate attendance docs (stress test #2.1) even if the button re-enables early.
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

    sealed interface ActionState {
        data object Idle : ActionState
        data object Loading : ActionState
        data class Error(val message: String) : ActionState
        data object Success : ActionState
        // User must type Site Name + Site ID — shown as a dialog with two text fields
        data object SiteInputRequired : ActionState
        data class MarketNameRequired(val currentLat: Double, val currentLng: Double) : ActionState
    }

    init {
        loadTodayData()
    }

    fun loadTodayData() {
        viewModelScope.launch {
            _attendanceState.value = UiState.Loading()
            val result = attendanceRepository.getTodayData()
            if (result.isFailure) {
                _attendanceState.value = UiState.Error("Failed to load attendance. Try again.")
                return@launch
            }
            val (state, events) = result.getOrThrow()
            _attendanceState.value = UiState.Success(state)
            _todayEvents.value = events
        }
    }

    // ── Home Check In ─────────────────────────────────────────────────────

    fun homeCheckIn() = submitEvent {
        _actionState.value = ActionState.Loading
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success -> {
                val result = attendanceRepository.recordEvent(
                    type      = AttendanceType.HOME_IN,
                    latitude  = location.latitude,
                    longitude = location.longitude
                )
                handleResult(result)
            }
            is LocationState.GpsDisabled ->
                _actionState.value = ActionState.Error("GPS is disabled. Please enable location services.")
            is LocationState.PermissionDenied ->
                _actionState.value = ActionState.Error("Location permission denied.")
            is LocationState.LowAccuracy ->
                _actionState.value = ActionState.Error("Location accuracy too low. Move to open area and try again.")
            is LocationState.Timeout ->
                _actionState.value = ActionState.Error("Location timed out. Try again.")
        }
    }

    // ── Home Check Out ────────────────────────────────────────────────────

    fun homeCheckOut() = submitEvent {
        _actionState.value = ActionState.Loading
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success -> {
                val result = attendanceRepository.recordEvent(
                    type      = AttendanceType.HOME_OUT,
                    latitude  = location.latitude,
                    longitude = location.longitude
                )
                handleResult(result)
            }
            is LocationState.GpsDisabled ->
                _actionState.value = ActionState.Error("GPS is disabled.")
            is LocationState.PermissionDenied ->
                _actionState.value = ActionState.Error("Location permission denied.")
            is LocationState.LowAccuracy ->
                _actionState.value = ActionState.Error("Location accuracy too low. Try again.")
            is LocationState.Timeout ->
                _actionState.value = ActionState.Error("Location timed out. Try again.")
        }
    }

    // ── Site Check In — Step 1: Show dialog for user to type Site Name + Site ID ──

    fun initiateSiteCheckIn() {
        _actionState.value = ActionState.SiteInputRequired
    }

    // ── Site Check In — Step 2: User typed site name + ID, record event ───
    // Geofence validation removed — user checks in from wherever they are.

    fun confirmSiteCheckIn(siteId: String, siteName: String) {
        if (siteName.isBlank()) {
            _actionState.value = ActionState.Error("Please enter the site name.")
            return
        }
        submitEvent {
            _actionState.value = ActionState.Loading
            when (val location = locationProvider.getCurrentLocation()) {
                is LocationState.Success -> {
                    val result = attendanceRepository.recordEvent(
                        type      = AttendanceType.SITE_IN,
                        latitude  = location.latitude,
                        longitude = location.longitude,
                        siteId    = siteId.trim(),
                        siteName  = siteName.trim()
                    )
                    handleResult(result)
                }
                is LocationState.GpsDisabled ->
                    _actionState.value = ActionState.Error("GPS is disabled.")
                is LocationState.PermissionDenied ->
                    _actionState.value = ActionState.Error("Location permission denied.")
                is LocationState.LowAccuracy ->
                    _actionState.value = ActionState.Error("Location accuracy too low. Move to open area.")
                is LocationState.Timeout ->
                    _actionState.value = ActionState.Error("Location timed out. Try again.")
            }
        }
    }

    // ── Site Check Out ────────────────────────────────────────────────────

    fun siteCheckOut(siteId: String, siteName: String) = submitEvent {
        _actionState.value = ActionState.Loading
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success -> {
                val result = attendanceRepository.recordEvent(
                    type      = AttendanceType.SITE_OUT,
                    latitude  = location.latitude,
                    longitude = location.longitude,
                    siteId    = siteId,
                    siteName  = siteName
                )
                handleResult(result)
            }
            is LocationState.GpsDisabled ->
                _actionState.value = ActionState.Error("GPS is disabled.")
            is LocationState.PermissionDenied ->
                _actionState.value = ActionState.Error("Location permission denied.")
            is LocationState.LowAccuracy ->
                _actionState.value = ActionState.Error("Location accuracy too low.")
            is LocationState.Timeout ->
                _actionState.value = ActionState.Error("Location timed out. Try again.")
        }
    }

    // ── Market Check In — Step 1: Get location first ──────────────────────

    fun initiateMarketCheckIn() = submitEvent {
        _actionState.value = ActionState.Loading
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success ->
                _actionState.value = ActionState.MarketNameRequired(
                    location.latitude, location.longitude
                )
            is LocationState.GpsDisabled ->
                _actionState.value = ActionState.Error("GPS is disabled.")
            is LocationState.PermissionDenied ->
                _actionState.value = ActionState.Error("Location permission denied.")
            is LocationState.LowAccuracy ->
                _actionState.value = ActionState.Error("Location accuracy too low.")
            is LocationState.Timeout ->
                _actionState.value = ActionState.Error("Location timed out. Try again.")
        }
    }

    // ── Market Check In — Step 2: User entered market name ───────────────
    // If currently SiteCheckedIn, auto-records site_out first (same GPS coords),
    // then records market_in. Both events appear in the timeline.

    fun confirmMarketCheckIn(marketName: String, latitude: Double, longitude: Double) {
        if (marketName.isBlank()) {
            _actionState.value = ActionState.Error("Please enter the market name.")
            return
        }
        submitEvent {
            _actionState.value = ActionState.Loading

            val currentState = (_attendanceState.value as? UiState.Success)?.data
            val previousEvents = _todayEvents.value
            val previousState = _attendanceState.value

            if (currentState is AttendanceState.SiteCheckedIn) {
                val siteRecord = currentState.record
                val siteOutResult = attendanceRepository.recordEvent(
                    type      = AttendanceType.SITE_OUT,
                    latitude  = latitude,
                    longitude = longitude,
                    siteId    = siteRecord.siteId,
                    siteName  = siteRecord.siteName
                )
                if (siteOutResult.isFailure) {
                    _actionState.value = ActionState.Error(
                        siteOutResult.exceptionOrNull()?.message ?: "Failed to auto check-out from site."
                    )
                    return@submitEvent
                }
                val withSiteOut = previousEvents + siteOutResult.getOrThrow()
                _todayEvents.value = withSiteOut
                _attendanceState.value = UiState.Success(deriveAttendanceState(withSiteOut))
            }

            val result = attendanceRepository.recordEvent(
                type        = AttendanceType.MARKET_IN,
                latitude    = latitude,
                longitude   = longitude,
                marketName  = marketName.trim()
            )
            if (result.isFailure && currentState is AttendanceState.SiteCheckedIn) {
                _todayEvents.value = previousEvents
                _attendanceState.value = previousState
                _actionState.value = ActionState.Error(
                    result.exceptionOrNull()?.message ?: "Failed to check in to market. Site check-out was reverted."
                )
                return@submitEvent
            }
            handleResult(result)
        }
    }

    // ── Market Check Out ──────────────────────────────────────────────────

    fun marketCheckOut(marketName: String) = submitEvent {
        _actionState.value = ActionState.Loading
        when (val location = locationProvider.getCurrentLocation()) {
            is LocationState.Success -> {
                val result = attendanceRepository.recordEvent(
                    type       = AttendanceType.MARKET_OUT,
                    latitude   = location.latitude,
                    longitude  = location.longitude,
                    marketName = marketName
                )
                handleResult(result)
            }
            is LocationState.GpsDisabled ->
                _actionState.value = ActionState.Error("GPS is disabled.")
            is LocationState.PermissionDenied ->
                _actionState.value = ActionState.Error("Location permission denied.")
            is LocationState.LowAccuracy ->
                _actionState.value = ActionState.Error("Location accuracy too low.")
            is LocationState.Timeout ->
                _actionState.value = ActionState.Error("Location timed out. Try again.")
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private fun handleResult(result: Result<AttendanceRecord>) {
        if (result.isSuccess) {
            val updatedEvents = _todayEvents.value + result.getOrThrow()
            _todayEvents.value = updatedEvents
            _attendanceState.value = UiState.Success(deriveAttendanceState(updatedEvents))
            _actionState.value = ActionState.Success
        } else {
            _actionState.value = ActionState.Error(
                result.exceptionOrNull()?.message ?: "Something went wrong. Try again."
            )
        }
    }

    fun resetActionState() {
        _actionState.value = ActionState.Idle
    }
}
