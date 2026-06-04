package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.data.repository.LeaveRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import javax.inject.Inject

@HiltViewModel
class ApplyLeaveViewModel @Inject constructor(
    private val leaveRepository: LeaveRepository
) : ViewModel() {

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    private val dateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")

    fun calculateDays(fromDate: String, toDate: String): Int {
        return try {
            val from = LocalDate.parse(fromDate, dateFormatter)
            val to   = LocalDate.parse(toDate, dateFormatter)
            (ChronoUnit.DAYS.between(from, to) + 1).toInt().coerceAtLeast(0)
        } catch (e: Exception) { 0 }
    }

    fun submit(leaveType: String, fromDate: String, toDate: String, reason: String) {
        if (leaveType.isBlank()) {
            _submitState.value = UiState.Error("Please select a leave type.")
            return
        }
        if (fromDate.isBlank() || toDate.isBlank()) {
            _submitState.value = UiState.Error("Please select both from and to dates.")
            return
        }
        val days = calculateDays(fromDate, toDate)
        if (days <= 0) {
            _submitState.value = UiState.Error("To date must be on or after from date.")
            return
        }
        if (reason.isBlank()) {
            _submitState.value = UiState.Error("Please enter a reason.")
            return
        }

        _submitState.value = UiState.Loading
        viewModelScope.launch {
            val request = LeaveRequest(
                leaveType  = leaveType,
                fromDate   = fromDate,
                toDate     = toDate,
                totalDays  = days,
                reason     = reason.trim()
            )
            val result = leaveRepository.submitLeaveRequest(request)
            _submitState.value = when {
                result.isSuccess -> UiState.Success(result.getOrThrow())
                else -> UiState.Error(
                    result.exceptionOrNull()?.message ?: "Submission failed. Try again."
                )
            }
        }
    }

    fun resetSubmitState() { _submitState.value = UiState.Empty }
}
