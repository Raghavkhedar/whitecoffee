package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.Site
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.repository.SiteRepository
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

@HiltViewModel
class AttendanceViewModel @Inject constructor(
    private val attendanceRepository: AttendanceRepository,
    private val siteRepository: SiteRepository,
    private val locationProvider: LocationProvider,
    private val sessionManager: SessionManager
) : ViewModel() {

    private val _attendanceState = MutableStateFlow<UiState<AttendanceState>>(UiState.Loading)
    val attendanceState: StateFlow<UiState<AttendanceState>> = _attendanceState.asStateFlow()

    private val _todayEvents = MutableStateFlow<List<AttendanceRecord>>(emptyList())
    val todayEvents: StateFlow<List<AttendanceRecord>> = _todayEvents.asStateFlow()

    private val _actionState = MutableStateFlow<ActionState>(ActionState.Idle)
    val actionState: StateFlow<ActionState> = _actionState.asStateFlow()

    private val _assignedSites = MutableStateFlow<List<Site>>(emptyList())
    val assignedSites: StateFlow<List<Site>> = _assignedSites.asStateFlow()

    val isOperations: Boolean get() = sessionManager.isOperations

    sealed interface ActionState {
        data object Idle : ActionState
        data object Loading : ActionState
        data class Error(val message: String) : ActionState
        data object Success : ActionState
        data class SiteSelectionRequired(val sites: List<Site>) : ActionState
        data class MarketNameRequired(val currentLat: Double, val currentLng: Double) : ActionState
    }

    init {
        loadTodayData()
    }

    fun loadTodayData() {
        viewModelScope.launch {
            _attendanceState.value = UiState.Loading

            // Load today's state
            val stateResult = attendanceRepository.getTodayState()
            if (stateResult.isFailure) {
                _attendanceState.value = UiState.Error("Failed to load attendance. Try again.")
                return@launch
            }
            _attendanceState.value = UiState.Success(stateResult.getOrThrow())

            // Load today's event log
            val eventsResult = attendanceRepository.getTodayEvents()
            if (eventsResult.isSuccess) {
                _todayEvents.value = eventsResult.getOrThrow()
            }

            // Load assigned sites
            val sitesResult = siteRepository.getAssignedSites()
            if (sitesResult.isSuccess) {
                _assignedSites.value = sitesResult.getOrThrow()
            }
        }
    }

    // ── Home Check In ─────────────────────────────────────────────────────

    fun homeCheckIn() {
        viewModelScope.launch {
            _actionState.value = ActionState.Loading
            val location = locationProvider.getCurrentLocation()
            when (location) {
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
    }

    // ── Home Check Out ────────────────────────────────────────────────────

    fun homeCheckOut() {
        viewModelScope.launch {
            _actionState.value = ActionState.Loading
            val location = locationProvider.getCurrentLocation()
            when (location) {
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
    }

    // ── Site Check In — Step 1: Get location, then show site picker ───────

    fun initiateSiteCheckIn() {
        viewModelScope.launch {
            _actionState.value = ActionState.Loading
            val sites = _assignedSites.value
            if (sites.isEmpty()) {
                _actionState.value = ActionState.Error("No sites assigned to you. Contact your administrator.")
                return@launch
            }
            // Show site selection dialog
            _actionState.value = ActionState.SiteSelectionRequired(sites)
        }
    }

    // ── Site Check In — Step 2: User picked a site, validate geofence ─────

    fun confirmSiteCheckIn(site: Site) {
        viewModelScope.launch {
            _actionState.value = ActionState.Loading
            val location = locationProvider.getCurrentLocation()
            when (location) {
                is LocationState.Success -> {
                    val distance = calculateDistance(
                        location.latitude, location.longitude,
                        site.latitude, site.longitude
                    )
                    if (distance > site.geofenceRadius) {
                        val distanceInt = distance.toInt()
                        _actionState.value = ActionState.Error(
                            "You are ${distanceInt}m away from ${site.name}. " +
                                    "You must be within ${site.geofenceRadius.toInt()}m to check in."
                        )
                        return@launch
                    }
                    // Inside geofence — record check in
                    val result = attendanceRepository.recordEvent(
                        type      = AttendanceType.SITE_IN,
                        latitude  = location.latitude,
                        longitude = location.longitude,
                        siteId    = site.id,
                        siteName  = site.name
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

    fun siteCheckOut(siteId: String, siteName: String) {
        viewModelScope.launch {
            _actionState.value = ActionState.Loading
            val location = locationProvider.getCurrentLocation()
            when (location) {
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
    }

    // ── Market Check In — Step 1: Get location first ──────────────────────

    fun initiateMarketCheckIn() {
        viewModelScope.launch {
            _actionState.value = ActionState.Loading
            val location = locationProvider.getCurrentLocation()
            when (location) {
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
    }

    // ── Market Check In — Step 2: User entered market name ───────────────

    fun confirmMarketCheckIn(marketName: String, latitude: Double, longitude: Double) {
        if (marketName.isBlank()) {
            _actionState.value = ActionState.Error("Please enter the market name.")
            return
        }
        viewModelScope.launch {
            _actionState.value = ActionState.Loading
            val result = attendanceRepository.recordEvent(
                type        = AttendanceType.MARKET_IN,
                latitude    = latitude,
                longitude   = longitude,
                marketName  = marketName.trim()
            )
            handleResult(result)
        }
    }

    // ── Market Check Out ──────────────────────────────────────────────────

    fun marketCheckOut(marketName: String) {
        viewModelScope.launch {
            _actionState.value = ActionState.Loading
            val location = locationProvider.getCurrentLocation()
            when (location) {
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
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    private suspend fun handleResult(result: Result<String>) {
        if (result.isSuccess) {
            _actionState.value = ActionState.Success
            loadTodayData()  // Refresh state after every event
        } else {
            _actionState.value = ActionState.Error(
                result.exceptionOrNull()?.message ?: "Something went wrong. Try again."
            )
        }
    }

    fun resetActionState() {
        _actionState.value = ActionState.Idle
    }

    /**
     * Haversine formula — calculates distance in meters between two GPS coordinates.
     */
    private fun calculateDistance(
        lat1: Double, lng1: Double,
        lat2: Double, lng2: Double
    ): Double {
        val earthRadius = 6371000.0 // metres
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = sin(dLat / 2) * sin(dLat / 2) +
                cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) *
                sin(dLng / 2) * sin(dLng / 2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return earthRadius * c
    }
}