package com.raghav.whitecoffee.core

/**
 * Universal UI state wrapper for every screen in WhiteCoffee.
 * Every Fragment observes a StateFlow<UiState<T>> — it is
 * structurally impossible to forget a state.
 */
sealed interface UiState<out T> {

    /** Initial load or ongoing async operation — show progress indicator. */
    data object Loading : UiState<Nothing>

    /** Data fetched successfully — show content. */
    data class Success<T>(val data: T) : UiState<T>

    /** Fetch succeeded but result set is empty — show empty illustration. */
    data object Empty : UiState<Nothing>

    /** Operation failed — show error message with retry option. */
    data class Error(val message: String) : UiState<Nothing>

    /** Device has no network — show offline banner. */
    data object Offline : UiState<Nothing>
}