package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.work.WorkManager
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.PhotoUploadManager
import com.raghav.whitecoffee.data.model.Transfer
import com.raghav.whitecoffee.data.model.TransferItem
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
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import javax.inject.Inject

@HiltViewModel
class TransferViewModel @Inject constructor(
    private val requestRepository: RequestRepository,
    private val photoUploadManager: PhotoUploadManager,
    private val workManager: WorkManager,
    networkMonitor: NetworkMonitor
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    private var pendingDocId: String? = null
    private var pendingCollection: String? = null
    private var uploadJob: Deferred<Result<List<String>>>? = null
    private var cacheJob: Deferred<List<String>>? = null

    fun onPhotosChanged(collection: String, uris: List<Uri>) {
        uploadJob?.cancel(); cacheJob?.cancel()
        if (uris.isEmpty()) {
            uploadJob = null; cacheJob = null
            pendingDocId = null; pendingCollection = null
            return
        }
        val docId = pendingDocId ?: requestRepository.newDocId(collection).also {
            pendingDocId = it
            pendingCollection = collection
        }
        cacheJob = viewModelScope.async { photoUploadManager.cachePhotos(uris, docId) }
        if (isOnline.value) {
            uploadJob = viewModelScope.async { photoUploadManager.uploadPhotos(uris, collection, docId) }
        }
    }

    fun submitMaterialTransfer(
        fromLocation: String,
        toLocation: String,
        transferredBy: String,
        receivedBy: String,
        items: List<TransferItem>,
        notes: String,
        photoUris: List<Uri> = emptyList()
    ) {
        if (!validateInputs(fromLocation, toLocation, transferredBy, receivedBy, items)) return
        _submitState.value = UiState.Loading()
        viewModelScope.launch {
            try {
                val collection = "material_transfers"
                val docId = pendingDocId ?: requestRepository.newDocId(collection)
                val cachedPaths = try {
                    cacheJob?.await() ?: if (photoUris.isNotEmpty()) photoUploadManager.cachePhotos(photoUris, docId) else emptyList()
                } catch (_: Exception) { emptyList() }
                val photoUrls = resolvePhotoUrls(collection, photoUris, docId) ?: emptyList()
                val needsRetry = photoUris.isNotEmpty() && photoUrls.isEmpty() && cachedPaths.isNotEmpty()

                val transfer = buildTransfer(fromLocation, toLocation, transferredBy, receivedBy, items, notes)
                val result = requestRepository.submitMaterialTransfer(transfer, docId, photoUrls)
                finish(result, collection, docId, needsRetry, cachedPaths)
            } catch (e: Exception) {
                _submitState.value = UiState.Error("Submission failed: ${e.message}")
                clearState()
            }
        }
    }

    fun submitToolTransfer(
        fromLocation: String,
        toLocation: String,
        transferredBy: String,
        receivedBy: String,
        items: List<TransferItem>,
        notes: String,
        photoUris: List<Uri> = emptyList()
    ) {
        if (!validateInputs(fromLocation, toLocation, transferredBy, receivedBy, items)) return
        _submitState.value = UiState.Loading()
        viewModelScope.launch {
            try {
                val collection = "tool_transfers"
                val docId = pendingDocId ?: requestRepository.newDocId(collection)
                val cachedPaths = try {
                    cacheJob?.await() ?: if (photoUris.isNotEmpty()) photoUploadManager.cachePhotos(photoUris, docId) else emptyList()
                } catch (_: Exception) { emptyList() }
                val photoUrls = resolvePhotoUrls(collection, photoUris, docId) ?: emptyList()
                val needsRetry = photoUris.isNotEmpty() && photoUrls.isEmpty() && cachedPaths.isNotEmpty()

                val transfer = buildTransfer(fromLocation, toLocation, transferredBy, receivedBy, items, notes)
                val result = requestRepository.submitToolTransfer(transfer, docId, photoUrls)
                finish(result, collection, docId, needsRetry, cachedPaths)
            } catch (e: Exception) {
                _submitState.value = UiState.Error("Submission failed: ${e.message}")
                clearState()
            }
        }
    }

    private fun finish(
        result: Result<String>,
        collection: String,
        docId: String,
        needsRetry: Boolean,
        cachedPaths: List<String>
    ) {
        if (result.isSuccess) {
            if (needsRetry) {
                workManager.enqueue(PhotoUploadWorker.buildRequest(collection, docId, cachedPaths))
            } else {
                photoUploadManager.clearCachedPhotos(docId)
            }
            _submitState.value = UiState.Success(result.getOrThrow())
        } else {
            photoUploadManager.clearCachedPhotos(docId)
            _submitState.value = UiState.Error(result.exceptionOrNull()?.message ?: "Submission failed. Try again.")
        }
        clearState()
    }

    private fun clearState() {
        uploadJob = null; cacheJob = null
        pendingDocId = null; pendingCollection = null
    }

    private suspend fun resolvePhotoUrls(
        collection: String,
        photoUris: List<Uri>,
        docId: String
    ): List<String>? {
        if (photoUris.isEmpty()) return emptyList()
        val job = uploadJob
        return if (job != null) {
            _submitState.value = UiState.Loading("Finishing photo upload…")
            job.await().getOrNull()
        } else if (isOnline.value) {
            photoUploadManager.uploadPhotos(photoUris, collection, docId) { current, total ->
                _submitState.value = UiState.Loading("Uploading photo $current of $total…")
            }.getOrNull()
        } else null
    }

    private fun validateInputs(
        from: String, to: String,
        transferredBy: String, receivedBy: String,
        items: List<TransferItem>
    ): Boolean {
        return when {
            from.isBlank() -> {
                _submitState.value = UiState.Error("Please enter the from location.")
                false
            }
            to.isBlank() -> {
                _submitState.value = UiState.Error("Please enter the to location.")
                false
            }
            transferredBy.isBlank() -> {
                _submitState.value = UiState.Error("Please enter who is transferring.")
                false
            }
            receivedBy.isBlank() -> {
                _submitState.value = UiState.Error("Please enter who is receiving.")
                false
            }
            items.isEmpty() -> {
                _submitState.value = UiState.Error("Please add at least one item.")
                false
            }
            items.any { it.itemName.isBlank() || it.quantity <= 0 } -> {
                _submitState.value = UiState.Error("Please fill in all item names and quantities.")
                false
            }
            else -> true
        }
    }

    private fun buildTransfer(
        from: String, to: String,
        transferredBy: String, receivedBy: String,
        items: List<TransferItem>,
        notes: String
    ): Transfer {
        val today = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))
        return Transfer(
            fromLocation  = from.trim(),
            toLocation    = to.trim(),
            transferredBy = transferredBy.trim(),
            receivedBy    = receivedBy.trim(),
            items         = items,
            notes         = notes.trim(),
            transferDate  = today
        )
    }

    fun resetSubmitState() { _submitState.value = UiState.Empty }
}
