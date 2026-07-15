package com.raghav.whitecoffee.ui.attendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.LeaveRepository
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class LeaveApprovalsViewModel @Inject constructor(
    private val leaveRepository: LeaveRepository,
    private val sessionManager: SessionManager,
    private val networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    private val _approvalsState = MutableStateFlow<UiState<List<LeaveRequest>>>(UiState.Loading())
    val approvalsState: StateFlow<UiState<List<LeaveRequest>>> = _approvalsState.asStateFlow()

    private val _actionState = MutableStateFlow<UiState<Unit>>(UiState.Empty)
    val actionState: StateFlow<UiState<Unit>> = _actionState.asStateFlow()

    init { loadPending() }

    private var loadJob: kotlinx.coroutines.Job? = null

    fun loadPending() {
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            if (!networkMonitor.isOnline.first()) {
                _approvalsState.value = UiState.Offline
                return@launch
            }
            _approvalsState.value = UiState.Loading()
            leaveRepository.observePendingLeaveRequests()
                .catch { _approvalsState.value = UiState.Error("Failed to load requests. Check Firestore index.") }
                .collect { list ->
                    _approvalsState.value = if (list.isEmpty()) UiState.Empty else UiState.Success(list)
                }
        }
    }

    fun approve(request: LeaveRequest) {
        viewModelScope.launch {
            _actionState.value = UiState.Loading()
            val result = leaveRepository.approveLeave(
                targetUserId = request.userId,
                requestId    = request.id,
                approverName = sessionManager.name
            )
            if (result.isSuccess) {
                _actionState.value = UiState.Success(Unit)
            } else {
                _actionState.value = UiState.Error(
                    result.exceptionOrNull()?.message ?: "Approval failed."
                )
            }
        }
    }

    fun reject(request: LeaveRequest, comment: String) {
        viewModelScope.launch {
            _actionState.value = UiState.Loading()
            val result = leaveRepository.rejectLeave(
                targetUserId = request.userId,
                requestId    = request.id,
                approverName = sessionManager.name,
                comment      = comment.trim()
            )
            if (result.isSuccess) {
                _actionState.value = UiState.Success(Unit)
            } else {
                _actionState.value = UiState.Error(
                    result.exceptionOrNull()?.message ?: "Rejection failed."
                )
            }
        }
    }

    fun resetActionState() { _actionState.value = UiState.Empty }
}
