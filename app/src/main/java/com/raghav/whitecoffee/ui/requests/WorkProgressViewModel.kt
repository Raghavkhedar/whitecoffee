package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.PhotoUploadManager
import com.raghav.whitecoffee.data.model.WorkProgress
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.RequestRepository
import com.raghav.whitecoffee.data.worker.PhotoUploadWorker
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class WorkProgressViewModel @Inject constructor(
    private val requestRepository: RequestRepository,
    private val photoUploadManager: PhotoUploadManager,
    private val workManager: WorkManager,
    networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    private val collection = "work_progress"

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    private var pendingDocId: String? = null
    private var cacheJob: Deferred<List<String>>? = null

    fun onPhotosChanged(uris: List<Uri>) {
        cacheJob?.cancel()
        if (uris.isEmpty()) { cacheJob = null; pendingDocId = null; return }
        val docId = pendingDocId ?: requestRepository.newDocId(collection).also { pendingDocId = it }
        // Pre-compress photos to disk while the user fills the form so submit stays instant.
        // The actual upload always runs in the background worker (survives navigation + process death).
        cacheJob = viewModelScope.async { photoUploadManager.cachePhotos(uris, docId) }
    }

    fun submitProgress(
        siteId: String,
        siteName: String,
        date: String,
        hoursWorked: Double,
        workDescription: String,
        photoUris: List<Uri> = emptyList()
    ) {
        if (workDescription.isBlank()) {
            _submitState.value = UiState.Error("Please enter a work description.")
            return
        }
        if (hoursWorked <= 0.0) {
            _submitState.value = UiState.Error("Please enter valid hours worked.")
            return
        }
        _submitState.value = UiState.Loading()
        viewModelScope.launch {
            try {
                val docId = pendingDocId ?: requestRepository.newDocId(collection)
                // Only wait on local compression (usually already done from onPhotosChanged) — never
                // on the network. Photos upload in the background worker after the doc is written.
                val cachedPaths = try {
                    cacheJob?.await() ?: if (photoUris.isNotEmpty()) photoUploadManager.cachePhotos(photoUris, docId) else emptyList()
                } catch (_: Exception) { emptyList() }

                val progress = WorkProgress(
                    siteId          = siteId.trim(),
                    siteName        = siteName.trim(),
                    date            = date,
                    hoursWorked     = hoursWorked,
                    workDescription = workDescription.trim()
                )
                // Doc is written with empty photoUrls; the worker patches them in once uploaded.
                val result = requestRepository.submitWorkProgress(progress, docId, emptyList())
                if (result.isSuccess) {
                    if (cachedPaths.isNotEmpty()) {
                        workManager.enqueue(PhotoUploadWorker.buildRequest(collection, docId, cachedPaths))
                    }
                    _submitState.value = UiState.Success(result.getOrThrow())
                } else {
                    photoUploadManager.clearCachedPhotos(docId)
                    _submitState.value = UiState.Error(result.exceptionOrNull()?.message ?: "Submission failed. Try again.")
                }
            } catch (e: Exception) {
                _submitState.value = UiState.Error("Submission failed: ${e.message}")
            } finally {
                cacheJob = null; pendingDocId = null
            }
        }
    }

    fun resetSubmitState() {
        _submitState.value = UiState.Empty
    }
}
