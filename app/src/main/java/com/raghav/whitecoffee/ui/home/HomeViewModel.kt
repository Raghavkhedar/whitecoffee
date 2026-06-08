package com.raghav.whitecoffee.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.repository.NotificationRepository
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val sessionManager: SessionManager,
    private val notificationRepository: NotificationRepository
) : ViewModel() {

    val userName: String get() = sessionManager.name
    val userRole: String get() = sessionManager.role
    val isOperations: Boolean get() = sessionManager.isOperations
    val isOffice: Boolean get() = sessionManager.isOffice
    val isAdmin: Boolean get() = sessionManager.isAdmin

    val greeting: String = run {
        val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
        when {
            hour < 12 -> "Good morning,"
            hour < 17 -> "Good afternoon,"
            else      -> "Good evening,"
        }
    }

    fun logout() {
        sessionManager.clearSession()
    }

    suspend fun getUnreadCount(): Int =
        notificationRepository.getUnreadCount().getOrDefault(0)
}
