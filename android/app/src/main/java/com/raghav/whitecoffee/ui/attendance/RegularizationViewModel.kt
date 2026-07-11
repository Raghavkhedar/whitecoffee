package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceStatusRules
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.RegularizationRequest
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.repository.RegularizationRepository
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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

    private val isOperations: Boolean get() = sessionManager.isOperations

    init {
        loadToday()
    }

    fun loadToday() {
        viewModelScope.launch {
            if (!networkMonitor.isOnline.first()) {
                _daysState.value = UiState.Offline
                return@launch
            }
            _daysState.value = UiState.Loading()
            try {
                val dataResult = attendanceRepository.getTodayData()
                if (dataResult.isFailure) {
                    _daysState.value = UiState.Error("Failed to load attendance data.")
                    return@launch
                }
                val (_, events) = dataResult.getOrThrow()
                val plannedWindow = if (isOperations) {
                    attendanceRepository.getTodayPlannedWindow().getOrNull()
                } else null
                val liveStatus = deriveLiveStatus(events, plannedWindow)

                if (liveStatus == null) {
                    _daysState.value = UiState.Empty
                    return@launch
                }

                val today = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))
                val requestResult = repository.getRequestForDate(today)
                val request = requestResult.getOrNull()

                val item = RegularizationDayItem(
                    date = today,
                    dayOfWeek = getDayOfWeek(today),
                    originalStatus = liveStatus,
                    request = request
                )
                _daysState.value = UiState.Success(listOf(item))
            } catch (e: Exception) {
                _daysState.value = UiState.Error("Something went wrong.")
            }
        }
    }

    // Returns the day's live status only when it's NOT clean (i.e. worth regularizing):
    // null = nothing to fix (Present/on-time, or a day payroll leaves unmarked), "SL"/"HalfDay"
    // otherwise. Scoring mirrors computeDailyAttendanceStatus: ops uses the first site/market
    // arrival → last departure against the day's planned shift; office uses office_in/out vs 10–18.
    private fun deriveLiveStatus(events: List<AttendanceRecord>, plannedWindow: Pair<Int, Int>?): String? {
        if (events.isEmpty()) return null

        val inRec: AttendanceRecord
        val outRec: AttendanceRecord?
        val startMin: Int
        val endMin: Int
        if (isOperations) {
            // No planned shift → payroll leaves the day unmarked; nothing to regularize.
            val window = plannedWindow ?: return null
            startMin = window.first
            endMin = window.second
            inRec = events.firstOrNull { it.type in AttendanceType.OPS_IN_TYPES } ?: return null
            val lastInIdx = events.indexOfLast { it.type in AttendanceType.OPS_IN_TYPES }
            val lastOutIdx = events.indexOfLast { it.type in AttendanceType.OPS_OUT_TYPES }
            outRec = events.lastOrNull { it.type in AttendanceType.OPS_OUT_TYPES }
                ?.takeIf { lastOutIdx > lastInIdx }
        } else {
            startMin = AttendanceStatusRules.OFFICE_START_MIN
            endMin = AttendanceStatusRules.OFFICE_END_MIN
            inRec = events.firstOrNull { it.type == AttendanceType.OFFICE_IN } ?: return null
            val lastInIdx = events.indexOfLast { it.type == AttendanceType.OFFICE_IN }
            val lastOutIdx = events.indexOfLast { it.type == AttendanceType.OFFICE_OUT }
            // Only count the checkout if it's the final event (they haven't re-entered since).
            outRec = events.lastOrNull { it.type == AttendanceType.OFFICE_OUT }
                ?.takeIf { lastOutIdx > lastInIdx }
        }

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
                loadToday()
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
