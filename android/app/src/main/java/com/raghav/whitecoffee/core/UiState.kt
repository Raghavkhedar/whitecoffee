package com.raghav.whitecoffee.core

/**
 * Universal UI state wrapper for every screen in WhiteCoffee.
 * Every Fragment observes a StateFlow<UiState<T>> — it is
 * structurally impossible to forget a state.
 */
sealed interface UiState<out T> {

    /** Initial load or ongoing async operation — show progress indicator.
     *  [message] is non-empty during photo uploads to show "Uploading photo X of Y…" */
    data class Loading(val message: String = "") : UiState<Nothing>

    /** Data fetched successfully — show content. */
    data class Success<T>(val data: T) : UiState<T>

    /** Fetch succeeded but result set is empty — show empty illustration. */
    data object Empty : UiState<Nothing>

    /** Operation failed — show error message with retry option. */
    data class Error(val message: String) : UiState<Nothing>
}
// There is deliberately no `Offline` state. Connectivity is not a screen state: Firestore is
// configured with a persistent local cache, so being offline does not mean being dataless — a
// screen still loads from disk and still accepts writes. An `Offline` variant invited ViewModels
// to check connectivity and return *before* subscribing, which hid data the SDK already had.
// Render connectivity with `OfflineBanner(isOnline)` over the content instead.