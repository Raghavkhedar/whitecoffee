package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.RegularizationRequest
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.RegularizationRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
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
    private val networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    private val _selectedMonth = MutableStateFlow(currentYearMonth())
    val selectedMonth: StateFlow<String> = _selectedMonth.asStateFlow()

    private val _daysState = MutableStateFlow<UiState<List<RegularizationDayItem>>>(UiState.Loading())
    val daysState: StateFlow<UiState<List<RegularizationDayItem>>> = _daysState.asStateFlow()

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    init {
        loadMonth()
    }

    fun loadMonth() {
        viewModelScope.launch {
            if (!networkMonitor.isOnline.first()) {
                _daysState.value = UiState.Offline
                return@launch
            }
            _daysState.value = UiState.Loading()
            try {
                val ym = _selectedMonth.value
                val statusResult = repository.getMonthAttendanceStatus(ym)
                val requestsResult = repository.getMyRequests(ym)

                if (statusResult.isFailure) {
                    _daysState.value = UiState.Error("Failed to load attendance data.")
                    return@launch
                }

                val flaggedDays = statusResult.getOrThrow()
                val requests = requestsResult.getOrDefault(emptyList())
                val requestsByDate = requests.associateBy { it.date }

                val items = flaggedDays.map { status ->
                    RegularizationDayItem(
                        date           = status.date,
                        dayOfWeek      = getDayOfWeek(status.date),
                        originalStatus = status.status,
                        request        = requestsByDate[status.date]
                    )
                }.sortedBy { it.date }

                _daysState.value = if (items.isEmpty()) UiState.Empty else UiState.Success(items)
            } catch (e: Exception) {
                _daysState.value = UiState.Error("Something went wrong.")
            }
        }
    }

    fun submitRequest(date: String, originalStatus: String, reason: String) {
        viewModelScope.launch {
            _submitState.value = UiState.Loading()
            val result = repository.submitRequest(date, originalStatus, reason)
            if (result.isSuccess) {
                _submitState.value = UiState.Success(result.getOrThrow())
                loadMonth()
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

    fun prevMonth() {
        _selectedMonth.value = offsetMonth(_selectedMonth.value, -1)
        loadMonth()
    }

    fun nextMonth() {
        _selectedMonth.value = offsetMonth(_selectedMonth.value, 1)
        loadMonth()
    }

    companion object {
        private val DAY_FORMAT = SimpleDateFormat("EEE", Locale.getDefault())
        private val DATE_PARSE = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())

        private fun currentYearMonth(): String {
            val cal = Calendar.getInstance()
            return String.format(Locale.US, "%04d-%02d", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1)
        }

        private fun offsetMonth(ym: String, offset: Int): String {
            val parts = ym.split("-")
            val cal = Calendar.getInstance().apply {
                set(Calendar.YEAR, parts[0].toInt())
                set(Calendar.MONTH, parts[1].toInt() - 1)
                add(Calendar.MONTH, offset)
            }
            return String.format(Locale.US, "%04d-%02d", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1)
        }

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
