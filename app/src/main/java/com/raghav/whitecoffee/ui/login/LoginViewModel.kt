package com.raghav.whitecoffee.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.messaging.FirebaseMessaging
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.User
import com.raghav.whitecoffee.data.repository.AuthRepository
import com.raghav.whitecoffee.data.repository.NotificationRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val notificationRepository: NotificationRepository
) : ViewModel() {

    private val _loginState = MutableStateFlow<UiState<User>>(UiState.Empty)
    val loginState: StateFlow<UiState<User>> = _loginState.asStateFlow()

    fun login(email: String, password: String) {

        // Local validation before hitting Firebase
        if (email.isBlank()) {
            _loginState.value = UiState.Error("Please enter your email or employee ID.")
            return
        }
        if (password.isBlank()) {
            _loginState.value = UiState.Error("Please enter your password.")
            return
        }
        if (password.length < 6) {
            _loginState.value = UiState.Error("Password must be at least 6 characters.")
            return
        }

        _loginState.value = UiState.Loading()

        viewModelScope.launch {
            val result = authRepository.login(email, password)
            if (result.isSuccess) {
                saveFcmToken()
                _loginState.value = UiState.Success(result.getOrThrow())
            } else {
                _loginState.value = UiState.Error(
                    result.exceptionOrNull()?.message ?: "Login failed. Please try again."
                )
            }
        }
    }

    private suspend fun saveFcmToken() {
        try {
            val token = FirebaseMessaging.getInstance().token.await()
            notificationRepository.saveToken(token)
        } catch (_: Exception) {
            // Non-critical — FcmService.onNewToken() will retry on next token refresh
        }
    }

    fun isAlreadyLoggedIn(): Boolean = authRepository.isLoggedIn()

    fun resetState() {
        _loginState.value = UiState.Empty
    }
}
