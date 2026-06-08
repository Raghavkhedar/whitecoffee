package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.PhotoUploadManager
import com.raghav.whitecoffee.data.model.MaterialToolRequest
import com.raghav.whitecoffee.data.model.RequestItem
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
class MaterialToolRequestViewModel @Inject constructor(
    private val requestRepository: RequestRepository,
    private val photoUploadManager: PhotoUploadManager
) : ViewModel() {

    private val collection = "material_requests"

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    // H3 — photos compress + upload in the background as soon as they are picked.
    private var pendingDocId: String? = null
    private var uploadJob: Deferred<Result<List<String>>>? = null

    /** Called by the Fragment whenever the photo selection changes. */
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

    fun submitRequest(
        siteId: String,
        siteName: String,
        items: List<RequestItem>,
        notes: String,
        photoUris: List<Uri> = emptyList()
    ) {
        if (items.isEmpty()) {
            _submitState.value = UiState.Error("Please add at least one item.")
            return
        }
        val invalidItem = items.firstOrNull { it.itemName.isBlank() || it.quantity <= 0 }
        if (invalidItem != null) {
            _submitState.value = UiState.Error("Please fill in all item names and quantities.")
            return
        }

        _submitState.value = UiState.Loading()
        viewModelScope.launch {
            try {
                val docId = pendingDocId ?: requestRepository.newDocId(collection)
                val photoUrls = resolvePhotoUrls(photoUris, docId)

                val request = MaterialToolRequest(
                    siteId   = siteId.trim(),
                    siteName = siteName.trim(),
                    items    = items,
                    notes    = notes.trim()
                )
                val result = requestRepository.submitMaterialToolRequest(request, docId, photoUrls)
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

    /** Awaits the background upload (usually already finished); falls back to inline upload. */
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
