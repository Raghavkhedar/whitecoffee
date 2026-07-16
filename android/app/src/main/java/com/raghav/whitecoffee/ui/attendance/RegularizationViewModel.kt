package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceStatusRules
import com.raghav.whitecoffee.data.model.RegularizationRequest
import com.raghav.whitecoffee.data.model.RoleCapabilities
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.repository.RegularizationRepository
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Calendar
import java.util.Locale
import javax.inject.Inject

data class RegularizationDayItem(
    val date: String,
    val dayOfWeek: String,
    val originalStatus: String,
    val request: RegularizationRequest? = null
)

@HiltViewModel
class RegularizationViewModel @Inject constructor(
    private val repository: RegularizationRepository,
    private val attendanceRepository: AttendanceRepository,
    private val sessionManager: SessionManager,
    private val networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    private val _daysState = MutableStateFlow<UiState<List<RegularizationDayItem>>>(UiState.Loading())
    val daysState: StateFlow<UiState<List<RegularizationDayItem>>> = _daysState.asStateFlow()

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    val todayLabel: String = run {
        val today = LocalDate.now()
        val formatter = DateTimeFormatter.ofPattern("d MMM yyyy, EEE", Locale.getDefault())
        today.format(formatter)
    }

    private val role: String get() = sessionManager.role

    /** Operations score against a planned shift; office/admin/sales use the fixed 10–18 window. */
    private val usesFixedWindow: Boolean get() = RoleCapabilities.usesFixedWindow(role)

    init {
        loadToday()
    }

    private var loadJob: kotlinx.coroutines.Job? = null

    fun loadToday() {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            if (!networkMonitor.isOnline.first()) {
                _daysState.value = UiState.Offline
                return@launch
            }
            _daysState.value = UiState.Loading()
            val plannedWindow = if (!usesFixedWindow) {
                attendanceRepository.getTodayPlannedWindow().getOrNull()
            } else null
            val today = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))

            combine(
                attendanceRepository.observeTodayData(),
                repository.observeRequestForDate(today)
            ) { data, request ->
                val liveStatus = deriveLiveStatus(data.second, plannedWindow)
                if (liveStatus == null) {
                    UiState.Empty
                } else {
                    UiState.Success(
                        listOf(
                            RegularizationDayItem(
                                date = today,
                                dayOfWeek = getDayOfWeek(today),
                                originalStatus = liveStatus,
                                request = request
                            )
                        )
                    )
                }
            }
                .catch { _daysState.value = UiState.Error("Something went wrong.") }
                .collect { _daysState.value = it }
        }
    }

    // Returns the day's live status only when it's NOT clean (i.e. worth regularizing):
    // null = nothing to fix (Present/on-time, or a day payroll leaves unmarked), "SL"/"HalfDay"
    // otherwise. Scoring mirrors computeDailyAttendanceStatus: the window comes from the role's
    // planned shift (ops) or the fixed 10–18 (office/admin/sales), and the in/out event types
    // come from RoleCapabilities — so a sales SITE-visit day is regularizable, not invisible.
    private fun deriveLiveStatus(events: List<AttendanceRecord>, plannedWindow: Pair<Int, Int>?): String? {
        if (events.isEmpty()) return null

        val startMin: Int
        val endMin: Int
        if (usesFixedWindow) {
            startMin = AttendanceStatusRules.OFFICE_START_MIN
            endMin = AttendanceStatusRules.OFFICE_END_MIN
        } else {
            // No planned shift → payroll leaves the day unmarked; nothing to regularize.
            val window = plannedWindow ?: return null
            startMin = window.first
            endMin = window.second
        }

        val inTypes = RoleCapabilities.attendanceInTypes(role)
        val outTypes = RoleCapabilities.attendanceOutTypes(role)
        val inRec = events.firstOrNull { it.type in inTypes } ?: return null
        val lastInIdx = events.indexOfLast { it.type in inTypes }
        val lastOutIdx = events.indexOfLast { it.type in outTypes }
        // Only count the checkout if it's the final event (they haven't re-entered since).
        val outRec = events.lastOrNull { it.type in outTypes }
            ?.takeIf { lastOutIdx > lastInIdx }

        val inMin = minutesOf(inRec) ?: return "HalfDay"
        val outMin = outRec?.let { minutesOf(it) }
        return when (AttendanceStatusRules.classify(inMin, outMin, startMin, endMin)) {
            AttendanceStatusRules.DayStatus.PRESENT -> null
            AttendanceStatusRules.DayStatus.SHORT_LEAVE -> "SL"
            AttendanceStatusRules.DayStatus.HALF_DAY -> "HalfDay"
        }
    }

    private fun minutesOf(record: AttendanceRecord): Int? {
        val date = record.timestamp?.toDate() ?: return null
        val cal = Calendar.getInstance().apply { time = date }
        return cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
    }

    fun submitRequest(date: String, originalStatus: String, reason: String) {
        viewModelScope.launch {
            _submitState.value = UiState.Loading()
            val result = repository.submitRequest(date, originalStatus, reason)
            if (result.isSuccess) {
                _submitState.value = UiState.Success(result.getOrThrow())
            } else {
                _submitState.value = UiState.Error(
                    result.exceptionOrNull()?.message ?: "Submission failed."
                )
            }
        }
    }

    fun resetSubmitState() {
        _submitState.value = UiState.Empty
    }

    companion object {
        private val DAY_FORMAT = SimpleDateFormat("EEE", Locale.getDefault())
        private val DATE_PARSE = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())

        private fun getDayOfWeek(date: String): String {
            return try {
                val parsed = DATE_PARSE.parse(date) ?: return ""
                DAY_FORMAT.format(parsed)
            } catch (e: Exception) {
                ""
            }
        }
    }
}
