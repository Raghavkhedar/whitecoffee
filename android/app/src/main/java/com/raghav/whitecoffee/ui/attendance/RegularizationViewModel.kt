package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.AttendanceRecord
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
                val liveStatus = deriveLiveStatus(events)

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

    private fun deriveLiveStatus(events: List<AttendanceRecord>): String? {
        if (events.isEmpty()) return null

        return if (isOperations) {
            val homeIn = events.firstOrNull { it.type == AttendanceType.HOME_IN }
                ?: return null
            val homeOut = events.lastOrNull { it.type == AttendanceType.HOME_OUT }
            val inHour = hourOf(homeIn) ?: return "HalfDay"

            if (homeOut != null) {
                val outHour = hourOf(homeOut) ?: return "HalfDay"
                if (inHour < 10 && outHour >= 18) null else "HalfDay"
            } else {
                if (inHour < 10) null else "HalfDay"
            }
        } else {
            val officeIn = events.firstOrNull { it.type == AttendanceType.OFFICE_IN }
                ?: return null
            val officeOut = events.lastOrNull { it.type == AttendanceType.OFFICE_OUT }
            val inHour = hourOf(officeIn) ?: return "HalfDay"

            val lastInIdx = events.indexOfLast { it.type == AttendanceType.OFFICE_IN }
            val lastOutIdx = events.indexOfLast { it.type == AttendanceType.OFFICE_OUT }

            if (officeOut != null && lastOutIdx > lastInIdx) {
                val outHour = hourOf(officeOut) ?: return "HalfDay"
                if (inHour < 10 && outHour >= 18) null else "HalfDay"
            } else {
                if (inHour < 10) null else "HalfDay"
            }
        }
    }

    private fun hourOf(record: AttendanceRecord): Int? {
        val date = record.timestamp?.toDate() ?: return null
        return Calendar.getInstance().apply { time = date }.get(Calendar.HOUR_OF_DAY)
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
