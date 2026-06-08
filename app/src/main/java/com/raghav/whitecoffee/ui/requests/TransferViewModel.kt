package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.PhotoUploadManager
import com.raghav.whitecoffee.data.model.Transfer
import com.raghav.whitecoffee.data.model.TransferItem
import com.raghav.whitecoffee.data.repository.RequestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import javax.inject.Inject

@HiltViewModel
class TransferViewModel @Inject constructor(
    private val requestRepository: RequestRepository,
    private val photoUploadManager: PhotoUploadManager
) : ViewModel() {

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    // H3 — photos compress + upload in the background as soon as they are picked.
    // Each Transfer screen (material / tool) uses its own collection name.
    private var pendingDocId: String? = null
    private var pendingCollection: String? = null
    private var uploadJob: Deferred<Result<List<String>>>? = null

    /** [collection] is "material_transfers" or "tool_transfers", chosen by the calling Fragment. */
    fun onPhotosChanged(collection: String, uris: List<Uri>) {
        uploadJob?.cancel()
        if (uris.isEmpty()) {
            uploadJob = null
            pendingDocId = null
            pendingCollection = null
            return
        }
        val docId = pendingDocId ?: requestRepository.newDocId(collection).also {
            pendingDocId = it
            pendingCollection = collection
        }
        uploadJob = viewModelScope.async {
            photoUploadManager.uploadPhotos(uris, collection, docId)
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
                val photoUrls = resolvePhotoUrls(collection, photoUris, docId)
                val transfer = buildTransfer(fromLocation, toLocation, transferredBy, receivedBy, items, notes)
                val result = requestRepository.submitMaterialTransfer(transfer, docId, photoUrls)
                finish(result)
            } catch (e: Exception) {
                _submitState.value = UiState.Error("Photo upload failed: ${e.message}")
                uploadJob = null
                pendingDocId = null
                pendingCollection = null
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
                val photoUrls = resolvePhotoUrls(collection, photoUris, docId)
                val transfer = buildTransfer(fromLocation, toLocation, transferredBy, receivedBy, items, notes)
                val result = requestRepository.submitToolTransfer(transfer, docId, photoUrls)
                finish(result)
            } catch (e: Exception) {
                _submitState.value = UiState.Error("Photo upload failed: ${e.message}")
                uploadJob = null
                pendingDocId = null
                pendingCollection = null
            }
        }
    }

    private fun finish(result: Result<String>) {
        _submitState.value = if (result.isSuccess) {
            UiState.Success(result.getOrThrow())
        } else {
            UiState.Error(result.exceptionOrNull()?.message ?: "Submission failed. Try again.")
        }
        uploadJob = null
        pendingDocId = null
        pendingCollection = null
    }

    private suspend fun resolvePhotoUrls(
        collection: String,
        photoUris: List<Uri>,
        docId: String
    ): List<String> {
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
