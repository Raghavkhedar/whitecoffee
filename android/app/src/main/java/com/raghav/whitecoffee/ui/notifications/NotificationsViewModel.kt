package com.raghav.whitecoffee.ui.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.AppNotification
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.NotificationRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class NotificationsViewModel @Inject constructor(
    private val notificationRepository: NotificationRepository,
    networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    private val _uiState = MutableStateFlow<UiState<List<AppNotification>>>(UiState.Loading())
    val uiState: StateFlow<UiState<List<AppNotification>>> = _uiState.asStateFlow()

    init { loadNotifications() }

    fun loadNotifications() {
        viewModelScope.launch {
            _uiState.value = UiState.Loading()
            notificationRepository.observeNotifications()
                .catch { _uiState.value = UiState.Error("Failed to load notifications.") }
                .collect { list ->
                    _uiState.value = if (list.isEmpty()) UiState.Empty else UiState.Success(list)
                }
        }
    }

    fun markAsRead(notifId: String) {
        viewModelScope.launch { notificationRepository.markAsRead(notifId) }
    }

    fun markAllAsRead() {
        viewModelScope.launch { notificationRepository.markAllAsRead() }
    }
}
