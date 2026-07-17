package com.raghav.whitecoffee

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState
import com.raghav.whitecoffee.data.model.AccountStatus
import com.raghav.whitecoffee.data.model.accountStatusFrom
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.willLogoutCloseDay
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.repository.AuthRepository
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager,
    private val authRepository: AuthRepository,
    private val attendanceRepository: AttendanceRepository,
    private val locationProvider: LocationProvider
) : ViewModel() {

    private val _sessionInvalidated = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val sessionInvalidated: SharedFlow<Unit> = _sessionInvalidated.asSharedFlow()

    private val _logoutInProgress = MutableStateFlow(false)
    val logoutInProgress: StateFlow<Boolean> = _logoutInProgress.asStateFlow()

    private val _logoutComplete = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val logoutComplete: SharedFlow<Unit> = _logoutComplete.asSharedFlow()

    private val _accountStatus = MutableStateFlow<AccountStatus>(AccountStatus.Active)
    val accountStatus: StateFlow<AccountStatus> = _accountStatus.asStateFlow()

    private var listenerRegistration: ListenerRegistration? = null

    fun startMonitorIfLoggedIn() {
        if (authRepository.isLoggedIn()) startMonitor()
    }

    fun onLoginSuccess() = startMonitor()

    private fun startMonitor() {
        val uid        = sessionManager.userId
        val localToken = sessionManager.sessionToken
        if (uid.isEmpty() || localToken.isEmpty()) return
        if (listenerRegistration != null) return

        listenerRegistration = firestore.collection("users").document(uid)
            .addSnapshotListener { snapshot, error ->
                if (error != null || snapshot == null || !snapshot.exists()) return@addSnapshotListener
                val active = snapshot.getBoolean("active") ?: true
                _accountStatus.value = accountStatusFrom(
                    active = active,
                    reason = snapshot.getString("suspendedReason") ?: "",
                    expectedReturn = snapshot.getString("expectedReturn") ?: "",
                )
                val firestoreToken = snapshot.getString("activeSessionToken") ?: return@addSnapshotListener
                if (firestoreToken.isNotEmpty() && firestoreToken != localToken) {
                    _sessionInvalidated.tryEmit(Unit)
                }
            }
    }

    fun logoutWithAutoCheckout() {
        if (_logoutInProgress.value) return
        _logoutInProgress.value = true
        viewModelScope.launch {
            try {
                autoCheckout()
            } catch (_: Exception) { }
            logout()
            _logoutInProgress.value = false
            _logoutComplete.tryEmit(Unit)
        }
    }

    fun logout() {
        listenerRegistration?.remove()
        listenerRegistration = null
        _accountStatus.value = AccountStatus.Active
        authRepository.logout()
    }

    private suspend fun autoCheckout() {
        val result = attendanceRepository.getTodayData()
        if (result.isFailure) return
        val (state, events) = result.getOrThrow()

        // Nothing open → nothing to close. Shares its answer with the home screen's logout
        // confirmation via willLogoutCloseDay, so the warning the user sees and the write that
        // follows can never disagree about whether the day ends.
        if (!willLogoutCloseDay(state, events, sessionManager.isOperations, sessionManager.isSales)) return

        val location = locationProvider.getCurrentLocation()
        if (location !is LocationState.Success) return

        // Sales is hybrid — the same person may be at a site OR in the office today — so close
        // whichever day is actually open instead of inferring it from the role. Sending a
        // site-checked-in sales user down the office path would leave the site_in unclosed, and
        // the nightly compute scores a day with no check-out as LNF (half pay).
        val inField = state is AttendanceState.SiteCheckedIn || state is AttendanceState.MarketCheckedIn
        if (sessionManager.isOperations || (sessionManager.isSales && inField)) {
            autoCheckoutOperations(state, location)
        } else {
            autoCheckoutOffice(events, location)
        }
    }

    private suspend fun autoCheckoutOperations(state: AttendanceState, loc: LocationState.Success) {
        when (state) {
            is AttendanceState.SiteCheckedIn -> {
                attendanceRepository.recordEvent(
                    type = AttendanceType.SITE_OUT,
                    latitude = loc.latitude, longitude = loc.longitude,
                    siteId = state.record.siteId, siteName = state.record.siteName
                )
                attendanceRepository.recordEvent(
                    type = AttendanceType.HOME_OUT,
                    latitude = loc.latitude, longitude = loc.longitude
                )
            }
            is AttendanceState.MarketCheckedIn -> {
                attendanceRepository.recordEvent(
                    type = AttendanceType.MARKET_OUT,
                    latitude = loc.latitude, longitude = loc.longitude,
                    marketName = state.record.marketName
                )
                attendanceRepository.recordEvent(
                    type = AttendanceType.HOME_OUT,
                    latitude = loc.latitude, longitude = loc.longitude
                )
            }
            is AttendanceState.HomeCheckedIn -> {
                attendanceRepository.recordEvent(
                    type = AttendanceType.HOME_OUT,
                    latitude = loc.latitude, longitude = loc.longitude
                )
            }
            else -> { }
        }
    }

    private suspend fun autoCheckoutOffice(events: List<com.raghav.whitecoffee.data.model.AttendanceRecord>, loc: LocationState.Success) {
        val hasHomeIn = events.any { it.type == AttendanceType.HOME_IN }
        val hasHomeOut = events.any { it.type == AttendanceType.HOME_OUT }
        if (!hasHomeIn || hasHomeOut) return

        val lastOffice = events.lastOrNull {
            it.type == AttendanceType.OFFICE_IN || it.type == AttendanceType.OFFICE_OUT
        }
        if (lastOffice?.type == AttendanceType.OFFICE_IN) {
            attendanceRepository.recordEvent(
                type = AttendanceType.OFFICE_OUT,
                latitude = loc.latitude, longitude = loc.longitude,
                locationName = lastOffice.locationName
            )
        }
        attendanceRepository.recordEvent(
            type = AttendanceType.HOME_OUT,
            latitude = loc.latitude, longitude = loc.longitude
        )
    }

    override fun onCleared() {
        listenerRegistration?.remove()
    }
}
