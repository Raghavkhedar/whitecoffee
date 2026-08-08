package com.raghav.whitecoffee

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.model.AccountStatus
import com.raghav.whitecoffee.data.model.isSessionSuperseded
import com.raghav.whitecoffee.data.notification.AttendanceNotifier
import com.raghav.whitecoffee.data.repository.AuthRepository
import com.raghav.whitecoffee.data.repository.UserRepository
import com.raghav.whitecoffee.data.session.SessionManager
import com.raghav.whitecoffee.domain.CloseOpenDayUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
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
    private val sessionManager: SessionManager,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val closeOpenDay: CloseOpenDayUseCase,
    private val attendanceNotifier: AttendanceNotifier,
) : ViewModel() {

    private val _sessionInvalidated = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val sessionInvalidated: SharedFlow<Unit> = _sessionInvalidated.asSharedFlow()

    private val _logoutInProgress = MutableStateFlow(false)
    val logoutInProgress: StateFlow<Boolean> = _logoutInProgress.asStateFlow()

    private val _logoutComplete = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val logoutComplete: SharedFlow<Unit> = _logoutComplete.asSharedFlow()

    private val _accountStatus = MutableStateFlow<AccountStatus>(AccountStatus.Active)
    val accountStatus: StateFlow<AccountStatus> = _accountStatus.asStateFlow()

    /**
     * Non-null while the account listener is attached. Doubles as the re-entrancy guard so
     * `startMonitorIfLoggedIn()` on every Activity start cannot stack duplicate listeners.
     * There is no `onCleared()` teardown because the job runs in `viewModelScope`, which the
     * framework cancels for us — [logout] cancels early only so a signed-out user stops
     * listening to a document they no longer have read access to.
     */
    private var monitorJob: Job? = null

    fun startMonitorIfLoggedIn() {
        if (authRepository.isLoggedIn()) startMonitor()
    }

    fun onLoginSuccess() = startMonitor()

    private fun startMonitor() {
        val uid        = sessionManager.userId
        val localToken = sessionManager.sessionToken
        if (uid.isEmpty() || localToken.isEmpty()) return
        if (monitorJob != null) return

        monitorJob = viewModelScope.launch {
            userRepository.observeAccount(uid).collect { snapshot ->
                _accountStatus.value = snapshot.status
                if (isSessionSuperseded(snapshot.activeSessionToken, localToken)) {
                    _sessionInvalidated.tryEmit(Unit)
                }
            }
        }
    }

    fun logoutWithAutoCheckout() {
        if (_logoutInProgress.value) return
        _logoutInProgress.value = true
        viewModelScope.launch {
            // Failures are swallowed on purpose: logout must always complete. Being offline, or
            // unable to get a fix, is not a reason to trap someone in a signed-in session.
            // Do not "fix" this catch without preserving guaranteed logout (decision #34b).
            try {
                closeOpenDay.invoke()
            } catch (_: Exception) { }
            logout()
            _logoutInProgress.value = false
            _logoutComplete.tryEmit(Unit)
        }
    }

    fun logout() {
        monitorJob?.cancel()
        monitorJob = null
        _accountStatus.value = AccountStatus.Active
        // The attendance ViewModels clear the "still checked in" reminder when they see the day
        // close, but neither is alive during a logout — and logout closes the day (auto-checkout
        // writes a terminal HOME_OUT). Without this, a signed-out device keeps an ongoing,
        // undismissable notification telling the next person they are checked in.
        attendanceNotifier.clear()
        authRepository.logout()
    }

}
