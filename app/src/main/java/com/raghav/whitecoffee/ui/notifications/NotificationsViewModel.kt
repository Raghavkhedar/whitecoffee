package com.raghav.whitecoffee.ui.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.AppNotification
import com.raghav.whitecoffee.data.repository.NotificationRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class NotificationsViewModel @Inject constructor(
    private val notificationRepository: NotificationRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<UiState<List<AppNotification>>>(UiState.Loading())
    val uiState: StateFlow<UiState<List<AppNotification>>> = _uiState.asStateFlow()

    init { loadNotifications() }

    fun loadNotifications() {
        viewModelScope.launch {
            _uiState.value = UiState.Loading()
            val result = notificationRepository.getNotifications()
            _uiState.value = when {
                result.isSuccess -> {
                    val list = result.getOrThrow()
                    if (list.isEmpty()) UiState.Empty else UiState.Success(list)
                }
                else -> UiState.Error("Failed to load notifications.")
            }
        }
    }

    fun markAsRead(notifId: String) {
        viewModelScope.launch {
            notificationRepository.markAsRead(notifId)
            val current = (_uiState.value as? UiState.Success)?.data ?: return@launch
            _uiState.value = UiState.Success(
                current.map { if (it.id == notifId) it.copy(isRead = true) else it }
            )
        }
    }

    fun markAllAsRead() {
        viewModelScope.launch {
            notificationRepository.markAllAsRead()
            val current = (_uiState.value as? UiState.Success)?.data ?: return@launch
            _uiState.value = UiState.Success(current.map { it.copy(isRead = true) })
        }
    }
}
