package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.isEventAllowed
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
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

    private fun currentAttendanceState(): AttendanceState =
        (_attendanceState.value as? UiState.Success)?.data ?: AttendanceState.NoRecord

    // Write-time guard against the button-visibility gate being stale (e.g. a check-in button
    // still on screen for a moment after home_out landed). Checked right before every event write
    // so an out-of-order tap can never reach Firestore, not just fail to render afterwards.
    private fun guardEvent(type: String): Boolean {
        val state = currentAttendanceState()
        if (isEventAllowed(state, type)) return true
        _actionState.value = ActionState.Error(
            if (state is AttendanceState.DayComplete) "Your day is already complete."
            else "That action isn't available right now. Pull down to refresh."
        )
        return false
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
            attendanceRepository.observeTodayData()
                .catch { _attendanceState.value = UiState.Error("Failed to load attendance. Try again.") }
                .collect { (state, events) ->
                    _attendanceState.value = UiState.Success(state)
                    _todayEvents.value = events
                }
        }
    }

    // ── Home Check In ─────────────────────────────────────────────────────

    fun homeCheckIn() = submitEvent {
        if (!guardEvent(AttendanceType.HOME_IN)) return@submitEvent
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
        if (!guardEvent(AttendanceType.HOME_OUT)) return@submitEvent
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
        if (!guardEvent(AttendanceType.SITE_IN)) return
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
            if (!guardEvent(AttendanceType.SITE_IN)) return@submitEvent
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
        if (!guardEvent(AttendanceType.SITE_OUT)) return@submitEvent
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
        if (!guardEvent(AttendanceType.MARKET_IN)) return@submitEvent
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
            if (!guardEvent(AttendanceType.MARKET_IN)) return@submitEvent
            _actionState.value = ActionState.Loading

            val currentState = (_attendanceState.value as? UiState.Success)?.data
            if (currentState is AttendanceState.SiteCheckedIn) {
                val siteRecord = currentState.record
                val siteOutResult = attendanceRepository.recordEvent(
                    type = AttendanceType.SITE_OUT,
                    latitude = latitude, longitude = longitude,
                    siteId = siteRecord.siteId, siteName = siteRecord.siteName,
                )
                if (siteOutResult.isFailure) {
                    _actionState.value = ActionState.Error(
                        siteOutResult.exceptionOrNull()?.message ?: "Failed to auto check-out from site."
                    )
                    return@submitEvent
                }
            }

            val result = attendanceRepository.recordEvent(
                type = AttendanceType.MARKET_IN,
                latitude = latitude, longitude = longitude,
                marketName = marketName.trim(),
            )
            handleResult(result)
        }
    }

    // ── Market Check Out ──────────────────────────────────────────────────

    fun marketCheckOut(marketName: String) = submitEvent {
        if (!guardEvent(AttendanceType.MARKET_OUT)) return@submitEvent
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
        _actionState.value =
            if (result.isSuccess) ActionState.Success
            else ActionState.Error(result.exceptionOrNull()?.message ?: "Something went wrong. Try again.")
    }

    fun resetActionState() {
        _actionState.value = ActionState.Idle
    }
}
