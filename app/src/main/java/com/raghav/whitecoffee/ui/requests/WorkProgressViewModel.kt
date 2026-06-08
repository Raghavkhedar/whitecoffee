package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.PhotoUploadManager
import com.raghav.whitecoffee.data.model.WorkProgress
import com.raghav.whitecoffee.data.repository.RequestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class WorkProgressViewModel @Inject constructor(
    private val requestRepository: RequestRepository,
    private val photoUploadManager: PhotoUploadManager
) : ViewModel() {

    private val collection = "work_progress"

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    // H3 — photos compress + upload in the background as soon as they are picked.
    private var pendingDocId: String? = null
    private var uploadJob: Deferred<Result<List<String>>>? = null

    fun onPhotosChanged(uris: List<Uri>) {
        uploadJob?.cancel()
        if (uris.isEmpty()) {
            uploadJob = null
            pendingDocId = null
            return
        }
        val docId = pendingDocId ?: requestRepository.newDocId(collection).also { pendingDocId = it }
        uploadJob = viewModelScope.async {
            photoUploadManager.uploadPhotos(uris, collection, docId)
        }
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
                val photoUrls = resolvePhotoUrls(photoUris, docId)

                val progress = WorkProgress(
                    siteId          = siteId.trim(),
                    siteName        = siteName.trim(),
                    date            = date,
                    hoursWorked     = hoursWorked,
                    workDescription = workDescription.trim()
                )
                val result = requestRepository.submitWorkProgress(progress, docId, photoUrls)
                _submitState.value = if (result.isSuccess) {
                    UiState.Success(result.getOrThrow())
                } else {
                    UiState.Error(result.exceptionOrNull()?.message ?: "Submission failed. Try again.")
                }
            } catch (e: Exception) {
                _submitState.value = UiState.Error("Photo upload failed: ${e.message}")
            } finally {
                uploadJob = null
                pendingDocId = null
            }
        }
    }

    private suspend fun resolvePhotoUrls(photoUris: List<Uri>, docId: String): List<String> {
        val job = uploadJob
        return when {
            job != null -> {
                _submitState.value = UiState.Loading("Finishing photo upload…")
                job.await().getOrThrow()
            }
            photoUris.isNotEmpty() -> {
                photoUploadManager.uploadPhotos(photoUris, collection, docId) { current, total ->
                    _submitState.value = UiState.Loading("Uploading photo $current of $total…")
                }.getOrThrow()
            }
            else -> emptyList()
        }
    }

    fun resetSubmitState() {
        _submitState.value = UiState.Empty
    }
}
