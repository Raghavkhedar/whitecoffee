package com.raghav.whitecoffee.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.willLogoutCloseDay
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.repository.NotificationRepository
import com.raghav.whitecoffee.data.session.SessionManager
import com.raghav.whitecoffee.domain.DayStatusPreview
import com.raghav.whitecoffee.domain.ResolveTodayStatusUseCase
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.Calendar
import javax.inject.Inject

/**
 * Everything the home screen renders, as one value.
 *
 * [todayStatus] and [logoutWouldEndDay] are derived from the same attendance emission and are
 * therefore updated together — as separate flows they could disagree for a frame, and the pair
 * that disagreed drove a destructive confirmation dialog.
 */
data class HomeUiState(
    val todayStatus: TodayAttendanceStatus = TodayAttendanceStatus.Loading,
    /**
     * True when logging out right now would close the user's day — i.e. auto-checkout would write
     * a terminal HOME_OUT. Drives the logout confirmation: an accidental logout ends the day just
     * as irreversibly as an accidental "End Day" tap, so it gets the same gate.
     *
     * Answered by the same willLogoutCloseDay the auto-checkout itself guards on, so the warning
     * cannot drift from the write.
     */
    val logoutWouldEndDay: Boolean = false,
    val unreadCount: Int = 0,
)

sealed interface TodayAttendanceStatus {
    data object Loading : TodayAttendanceStatus
    data object NotCheckedIn : TodayAttendanceStatus
    data class Present(val location: String, val since: String) : TodayAttendanceStatus
    data class ShortLeave(val location: String, val since: String) : TodayAttendanceStatus
    data class HalfDay(val location: String, val since: String) : TodayAttendanceStatus
    // Operations only: checked in, but no verdict yet — either no planned shift is set for
    // today (payroll leaves such days unmarked) or the user hasn't reached a site/market yet.
    data class Pending(val location: String, val since: String) : TodayAttendanceStatus
    data object Error : TodayAttendanceStatus
}

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val sessionManager: SessionManager,
    private val notificationRepository: NotificationRepository,
    private val attendanceRepository: AttendanceRepository,
    private val resolveTodayStatus: ResolveTodayStatusUseCase,
    networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    val userName: String get() = sessionManager.name
    val userRole: String get() = sessionManager.role
    val isOperations: Boolean get() = sessionManager.isOperations
    val isOffice: Boolean get() = sessionManager.isOffice
    val isSales: Boolean get() = sessionManager.isSales
    val isAdmin: Boolean get() = sessionManager.isAdmin

    val greeting: String = run {
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        when {
            hour < 12 -> "Good morning"
            hour < 17 -> "Good afternoon"
            else      -> "Good evening"
        }
    }

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        observeUnreadCount()
        loadTodayAttendance()
    }

    private fun observeUnreadCount() {
        viewModelScope.launch {
            notificationRepository.observeUnreadCount()
                .catch { /* keep last known count on transient error */ }
                .collect { count -> _uiState.update { it.copy(unreadCount = count) } }
        }
    }

    private var todayJob: kotlinx.coroutines.Job? = null

    fun loadTodayAttendance() {
        todayJob?.cancel()
        todayJob = viewModelScope.launch {
            _uiState.update { it.copy(todayStatus = TodayAttendanceStatus.Loading) }
            val plannedWindow = if (isOperations) {
                attendanceRepository.getTodayPlannedWindow().getOrNull()
            } else null
            attendanceRepository.observeTodayData()
                .catch { _uiState.update { s -> s.copy(todayStatus = TodayAttendanceStatus.Error) } }
                .collect { (state, events) ->
                    // One update, not two. These are derived from the SAME emission, and while
                    // they were separate flows a collector could see the new status alongside the
                    // previous logoutWouldEndDay — long enough to warn "this ends your day" about
                    // a day that had just ended.
                    _uiState.update {
                        it.copy(
                            todayStatus = deriveTodayStatus(events, plannedWindow),
                            logoutWouldEndDay =
                                willLogoutCloseDay(state, events, isOperations, isSales),
                        )
                    }
                }
        }
    }

    private fun deriveTodayStatus(
        events: List<AttendanceRecord>,
        plannedWindow: Pair<Int, Int>?,
    ): TodayAttendanceStatus {
        if (events.isEmpty()) return TodayAttendanceStatus.NotCheckedIn

        val preview = resolveTodayStatus(events, plannedWindow)
        if (preview == DayStatusPreview.NOT_CHECKED_IN) return TodayAttendanceStatus.NotCheckedIn

        val lastEvent = events.last()
        val location = deriveLocation(lastEvent)
        val since = lastEvent.displayTime()

        return when (preview) {
            DayStatusPreview.PRESENT        -> TodayAttendanceStatus.Present(location, since)
            DayStatusPreview.SHORT_LEAVE    -> TodayAttendanceStatus.ShortLeave(location, since)
            DayStatusPreview.HALF_DAY       -> TodayAttendanceStatus.HalfDay(location, since)
            DayStatusPreview.PENDING        -> TodayAttendanceStatus.Pending(location, since)
            DayStatusPreview.NOT_CHECKED_IN -> TodayAttendanceStatus.NotCheckedIn
        }
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

}
