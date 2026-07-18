package com.raghav.whitecoffee.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceStatusRules
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.RoleCapabilities
import com.raghav.whitecoffee.data.model.willLogoutCloseDay
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.repository.NotificationRepository
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.util.Calendar
import javax.inject.Inject

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

    private val _todayStatus = MutableStateFlow<TodayAttendanceStatus>(TodayAttendanceStatus.Loading)
    val todayStatus: StateFlow<TodayAttendanceStatus> = _todayStatus.asStateFlow()

    /**
     * True when logging out right now would close the user's day — i.e. auto-checkout would write
     * a terminal HOME_OUT. Drives the logout confirmation: an accidental logout ends the day just
     * as irreversibly as an accidental "End Day" tap, so it gets the same gate. False (the day is
     * not open) means logging out costs nothing and needs no confirmation.
     *
     * Answered by the same willLogoutCloseDay the auto-checkout itself guards on, so the warning
     * cannot drift from the write.
     */
    private val _logoutWouldEndDay = MutableStateFlow(false)
    val logoutWouldEndDay: StateFlow<Boolean> = _logoutWouldEndDay.asStateFlow()

    private val _unreadCount = MutableStateFlow(0)
    val unreadCount: StateFlow<Int> = _unreadCount.asStateFlow()

    init {
        observeUnreadCount()
        loadTodayAttendance()
    }

    private fun observeUnreadCount() {
        viewModelScope.launch {
            notificationRepository.observeUnreadCount()
                .catch { /* keep last known count on transient error */ }
                .collect { _unreadCount.value = it }
        }
    }

    private var todayJob: kotlinx.coroutines.Job? = null

    fun loadTodayAttendance() {
        todayJob?.cancel()
        todayJob = viewModelScope.launch {
            _todayStatus.value = TodayAttendanceStatus.Loading
            val plannedWindow = if (isOperations) {
                attendanceRepository.getTodayPlannedWindow().getOrNull()
            } else null
            attendanceRepository.observeTodayData()
                .catch { _todayStatus.value = TodayAttendanceStatus.Error }
                .collect { (state, events) ->
                    _todayStatus.value = deriveTodayStatus(events, plannedWindow)
                    _logoutWouldEndDay.value =
                        willLogoutCloseDay(state, events, isOperations, isSales)
                }
        }
    }

    private fun deriveTodayStatus(
        events: List<AttendanceRecord>,
        plannedWindow: Pair<Int, Int>?,
    ): TodayAttendanceStatus {
        if (events.isEmpty()) return TodayAttendanceStatus.NotCheckedIn

        val dailyStatus = when {
            isOperations -> deriveOpsDailyStatus(events, plannedWindow)
            isSales      -> deriveSalesDailyStatus(events)
            else         -> deriveOfficeDailyStatus(events)
        }

        if (dailyStatus == DailyStatus.NOT_CHECKED_IN) return TodayAttendanceStatus.NotCheckedIn

        val lastEvent = events.last()
        val location = deriveLocation(lastEvent)
        val since = lastEvent.displayTime()

        return when (dailyStatus) {
            DailyStatus.PRESENT -> TodayAttendanceStatus.Present(location, since)
            DailyStatus.SHORT_LEAVE -> TodayAttendanceStatus.ShortLeave(location, since)
            DailyStatus.HALF_DAY -> TodayAttendanceStatus.HalfDay(location, since)
            DailyStatus.PENDING -> TodayAttendanceStatus.Pending(location, since)
            DailyStatus.NOT_CHECKED_IN -> TodayAttendanceStatus.NotCheckedIn
        }
    }

    private enum class DailyStatus { PRESENT, SHORT_LEAVE, HALF_DAY, PENDING, NOT_CHECKED_IN }

    private fun AttendanceStatusRules.DayStatus.toDaily(): DailyStatus = when (this) {
        AttendanceStatusRules.DayStatus.PRESENT -> DailyStatus.PRESENT
        AttendanceStatusRules.DayStatus.SHORT_LEAVE -> DailyStatus.SHORT_LEAVE
        AttendanceStatusRules.DayStatus.HALF_DAY -> DailyStatus.HALF_DAY
    }

    // Ops: scored on arrival at the first site/market and departure from the last, against the
    // day's planned shift — matching computeDailyAttendanceStatus. With no planned shift the day
    // is scored against the default 10:00–18:00 instead (mirrors the cloud function's window
    // fallback, and the portal's otLedger DEFAULT_SHIFT_*_MIN, which already scored no-plan days
    // that way). Not-yet-at-any-site → PENDING: the day has no verdict *yet* — they may still
    // turn up. It is only a preview: if they never do, the nightly scores the day Absent.
    private fun deriveOpsDailyStatus(
        events: List<AttendanceRecord>,
        window: Pair<Int, Int>?,
    ): DailyStatus {
        val (startMin, endMin) = window
            ?: (AttendanceStatusRules.OFFICE_START_MIN to AttendanceStatusRules.OFFICE_END_MIN)
        val firstIn = events.firstOrNull { it.type in AttendanceType.OPS_IN_TYPES }
            ?: return DailyStatus.PENDING
        val inMin = minutesOf(firstIn) ?: return DailyStatus.PENDING
        // Only score a checkout that's the user's final event — if they've re-entered a
        // site/market since (still out in the field), the day is in progress.
        val lastInIdx = events.indexOfLast { it.type in AttendanceType.OPS_IN_TYPES }
        val lastOutIdx = events.indexOfLast { it.type in AttendanceType.OPS_OUT_TYPES }
        val outMin = if (lastOutIdx > lastInIdx) minutesOf(events[lastOutIdx]) else null
        return AttendanceStatusRules.classify(inMin, outMin, startMin, endMin).toDaily()
    }

    // Sales: hybrid role. Scored on the FIXED 10:00–18:00 window (like office) but over the first
    // check-in of ANY type and the last check-out of ANY type — office_in/site_in/market_in and
    // office_out/site_out/market_out. Event source comes from RoleCapabilities so this stays in
    // lockstep with the backend. No OT/shortage, no planned shift. Matches computeDailyAttendanceStatus.
    private fun deriveSalesDailyStatus(events: List<AttendanceRecord>): DailyStatus {
        val inTypes = RoleCapabilities.attendanceInTypes(SessionManager.ROLE_SALES).toSet()
        val outTypes = RoleCapabilities.attendanceOutTypes(SessionManager.ROLE_SALES).toSet()

        val firstIn = events.firstOrNull { it.type in inTypes } ?: return DailyStatus.NOT_CHECKED_IN
        val inMin = minutesOf(firstIn) ?: return DailyStatus.HALF_DAY

        val lastInIdx = events.indexOfLast { it.type in inTypes }
        val lastOutIdx = events.indexOfLast { it.type in outTypes }
        // Only score a checkout that's the user's final event; otherwise the day is in progress.
        val outMin = if (lastOutIdx > lastInIdx) minutesOf(events[lastOutIdx]) else null

        return AttendanceStatusRules.classify(inMin, outMin).toDaily()
    }

    private fun deriveOfficeDailyStatus(events: List<AttendanceRecord>): DailyStatus {
        val officeIn = events.firstOrNull { it.type == AttendanceType.OFFICE_IN }
            ?: return DailyStatus.NOT_CHECKED_IN
        val inMin = minutesOf(officeIn) ?: return DailyStatus.HALF_DAY

        val lastInIdx = events.indexOfLast { it.type == AttendanceType.OFFICE_IN }
        val lastOutIdx = events.indexOfLast { it.type == AttendanceType.OFFICE_OUT }
        val officeOut = events.lastOrNull { it.type == AttendanceType.OFFICE_OUT }
        // Only count the checkout if it's the final event (they haven't re-entered since).
        val outMin = if (officeOut != null && lastOutIdx > lastInIdx) minutesOf(officeOut) else null

        return AttendanceStatusRules.classify(inMin, outMin).toDaily()
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

    private fun minutesOf(record: AttendanceRecord): Int? {
        val date = record.timestamp?.toDate() ?: return null
        val cal = Calendar.getInstance().apply { time = date }
        return cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
    }

}
