package com.raghav.whitecoffee.ui.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.User
import com.raghav.whitecoffee.data.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _loginState = MutableStateFlow<UiState<User>>(UiState.Empty)
    val loginState: StateFlow<UiState<User>> = _loginState.asStateFlow()

    fun login(email: String, password: String) {

        // Local validation before hitting Firebase
        if (email.isBlank()) {
            _loginState.value = UiState.Error("Please enter your email address.")
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

        _loginState.value = UiState.Loading

        viewModelScope.launch {
            val result = authRepository.login(email, password)
            _loginState.value = when {
                result.isSuccess -> UiState.Success(result.getOrThrow())
                else -> UiState.Error(
                    result.exceptionOrNull()?.message ?: "Login failed. Please try again."
                )
            }
        }
    }

    fun isAlreadyLoggedIn(): Boolean = authRepository.isLoggedIn()

    fun resetState() {
        _loginState.value = UiState.Empty
    }
}