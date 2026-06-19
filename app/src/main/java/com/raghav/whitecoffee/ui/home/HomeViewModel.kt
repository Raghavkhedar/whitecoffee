package com.raghav.whitecoffee.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.deriveAttendanceState
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.repository.NotificationRepository
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface TodayAttendanceStatus {
    data object Loading : TodayAttendanceStatus
    data object NotCheckedIn : TodayAttendanceStatus
    data class CheckedIn(val label: String) : TodayAttendanceStatus
    data object DayComplete : TodayAttendanceStatus
}

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val sessionManager: SessionManager,
    private val notificationRepository: NotificationRepository,
    private val attendanceRepository: AttendanceRepository,
    networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    val userName: String get() = sessionManager.name
    val userRole: String get() = sessionManager.role
    val isOperations: Boolean get() = sessionManager.isOperations
    val isOffice: Boolean get() = sessionManager.isOffice
    val isAdmin: Boolean get() = sessionManager.isAdmin

    val greeting: String = run {
        val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        when {
            hour < 12 -> "Good morning,"
            hour < 17 -> "Good afternoon,"
            else      -> "Good evening,"
        }
    }

    private val _todayStatus = MutableStateFlow<TodayAttendanceStatus>(TodayAttendanceStatus.Loading)
    val todayStatus: StateFlow<TodayAttendanceStatus> = _todayStatus.asStateFlow()

    init {
        loadTodayAttendance()
    }

    fun loadTodayAttendance() {
        viewModelScope.launch {
            _todayStatus.value = TodayAttendanceStatus.Loading
            val result = attendanceRepository.getTodayData()
            if (result.isFailure) {
                _todayStatus.value = TodayAttendanceStatus.NotCheckedIn
                return@launch
            }
            val (state, events) = result.getOrThrow()
            _todayStatus.value = if (isOperations) {
                when (state) {
                    is AttendanceState.NoRecord -> TodayAttendanceStatus.NotCheckedIn
                    is AttendanceState.HomeCheckedIn -> TodayAttendanceStatus.CheckedIn("Checked in")
                    is AttendanceState.SiteCheckedIn -> TodayAttendanceStatus.CheckedIn("On site")
                    is AttendanceState.MarketCheckedIn -> TodayAttendanceStatus.CheckedIn("At market")
                    is AttendanceState.DayComplete -> TodayAttendanceStatus.DayComplete
                }
            } else {
                val lastEvent = events.lastOrNull()
                if (lastEvent?.type == AttendanceType.OFFICE_IN) {
                    TodayAttendanceStatus.CheckedIn("Checked in")
                } else if (events.isNotEmpty() && lastEvent?.type == AttendanceType.OFFICE_OUT) {
                    TodayAttendanceStatus.CheckedIn("Last: checked out")
                } else {
                    TodayAttendanceStatus.NotCheckedIn
                }
            }
        }
    }

    fun logout() {
        sessionManager.clearSession()
    }

    suspend fun getUnreadCount(): Int =
        notificationRepository.getUnreadCount().getOrDefault(0)
}
