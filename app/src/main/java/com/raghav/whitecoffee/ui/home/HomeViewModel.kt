package com.raghav.whitecoffee.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
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
import java.util.Calendar
import javax.inject.Inject

sealed interface TodayAttendanceStatus {
    data object Loading : TodayAttendanceStatus
    data object NotCheckedIn : TodayAttendanceStatus
    data class Present(val location: String, val since: String) : TodayAttendanceStatus
    data class HalfDay(val location: String, val since: String) : TodayAttendanceStatus
    data object Error : TodayAttendanceStatus
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
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        when {
            hour < 12 -> "Good morning"
            hour < 17 -> "Good afternoon"
            else      -> "Good evening"
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
                _todayStatus.value = TodayAttendanceStatus.Error
                return@launch
            }
            val (_, events) = result.getOrThrow()

            if (events.isEmpty()) {
                _todayStatus.value = TodayAttendanceStatus.NotCheckedIn
                return@launch
            }

            val dailyStatus = if (isOperations) deriveOpsDailyStatus(events) else deriveOfficeDailyStatus(events)

            if (dailyStatus == DailyStatus.NOT_CHECKED_IN) {
                _todayStatus.value = TodayAttendanceStatus.NotCheckedIn
                return@launch
            }

            val lastEvent = events.last()
            val location = deriveLocation(lastEvent)
            val since = lastEvent.displayTime()

            _todayStatus.value = when (dailyStatus) {
                DailyStatus.PRESENT -> TodayAttendanceStatus.Present(location, since)
                DailyStatus.HALF_DAY -> TodayAttendanceStatus.HalfDay(location, since)
                else -> TodayAttendanceStatus.NotCheckedIn
            }
        }
    }

    private enum class DailyStatus { PRESENT, HALF_DAY, NOT_CHECKED_IN }

    private fun deriveOpsDailyStatus(events: List<AttendanceRecord>): DailyStatus {
        val homeIn = events.firstOrNull { it.type == AttendanceType.HOME_IN }
            ?: return DailyStatus.NOT_CHECKED_IN
        val homeOut = events.lastOrNull { it.type == AttendanceType.HOME_OUT }

        val inHour = hourOf(homeIn) ?: return DailyStatus.HALF_DAY

        if (homeOut != null) {
            val outHour = hourOf(homeOut) ?: return DailyStatus.HALF_DAY
            return if (inHour < 10 && outHour >= 18) DailyStatus.PRESENT else DailyStatus.HALF_DAY
        }

        return if (inHour < 10) DailyStatus.PRESENT else DailyStatus.HALF_DAY
    }

    private fun deriveOfficeDailyStatus(events: List<AttendanceRecord>): DailyStatus {
        val officeIn = events.firstOrNull { it.type == AttendanceType.OFFICE_IN }
            ?: return DailyStatus.NOT_CHECKED_IN
        val officeOut = events.lastOrNull { it.type == AttendanceType.OFFICE_OUT }

        val inHour = hourOf(officeIn) ?: return DailyStatus.HALF_DAY

        val lastInIdx = events.indexOfLast { it.type == AttendanceType.OFFICE_IN }
        val lastOutIdx = events.indexOfLast { it.type == AttendanceType.OFFICE_OUT }

        if (officeOut != null && lastOutIdx > lastInIdx) {
            val outHour = hourOf(officeOut) ?: return DailyStatus.HALF_DAY
            return if (inHour < 10 && outHour >= 18) DailyStatus.PRESENT else DailyStatus.HALF_DAY
        }

        return if (inHour < 10) DailyStatus.PRESENT else DailyStatus.HALF_DAY
    }

    private fun deriveLocation(event: AttendanceRecord): String {
        return when (event.type) {
            AttendanceType.HOME_IN -> "At Home"
            AttendanceType.HOME_OUT -> "Checked out"
            AttendanceType.SITE_IN -> if (event.siteName.isNotBlank()) "At ${event.siteName}" else "At Site"
            AttendanceType.SITE_OUT -> "Left site"
            AttendanceType.MARKET_IN -> if (event.marketName.isNotBlank()) "At ${event.marketName}" else "At Market"
            AttendanceType.MARKET_OUT -> "Left market"
            AttendanceType.OFFICE_IN -> if (event.locationName.isNotBlank()) "In Office: ${event.locationName}" else "In Office"
            AttendanceType.OFFICE_OUT -> "Left office"
            else -> ""
        }
    }

    private fun hourOf(record: AttendanceRecord): Int? {
        val date = record.timestamp?.toDate() ?: return null
        return Calendar.getInstance().apply { time = date }.get(Calendar.HOUR_OF_DAY)
    }

    suspend fun getUnreadCount(): Int =
        notificationRepository.getUnreadCount().getOrDefault(0)
}
