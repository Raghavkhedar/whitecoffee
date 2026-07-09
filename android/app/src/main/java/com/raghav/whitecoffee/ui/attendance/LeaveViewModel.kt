package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.LeaveRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class LeaveViewModel @Inject constructor(
    private val leaveRepository: LeaveRepository,
    networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    private val _leavesState = MutableStateFlow<UiState<List<LeaveRequest>>>(UiState.Loading())
    val leavesState: StateFlow<UiState<List<LeaveRequest>>> = _leavesState.asStateFlow()

    init { loadLeaves() }

    fun loadLeaves() {
        viewModelScope.launch {
            _leavesState.value = UiState.Loading()
            val result = leaveRepository.getMyLeaveRequests()
            _leavesState.value = when {
                result.isSuccess -> {
                    val list = result.getOrThrow()
                    if (list.isEmpty()) UiState.Empty else UiState.Success(list)
                }
                else -> UiState.Error("Failed to load leave requests.")
            }
        }
    }
}
