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
        _submitState.value = UiState.Loading
        viewModelScope.launch {
            val transfer = buildTransfer(fromLocation, toLocation, transferredBy, receivedBy, items, notes)
            val result = requestRepository.submitMaterialTransfer(transfer)
            if (result.isFailure) {
                _submitState.value = UiState.Error(
                    result.exceptionOrNull()?.message ?: "Submission failed. Try again."
                )
                return@launch
            }
            val docId = result.getOrThrow()
            if (photoUris.isNotEmpty()) {
                val uploadResult = photoUploadManager.uploadPhotos(
                    photoUris, "material_transfers", docId
                )
                if (uploadResult.isSuccess) {
                    requestRepository.updatePhotoUrls(
                        "material_transfers", docId, uploadResult.getOrThrow()
                    )
                }
            }
            _submitState.value = UiState.Success(docId)
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
        _submitState.value = UiState.Loading
        viewModelScope.launch {
            val transfer = buildTransfer(fromLocation, toLocation, transferredBy, receivedBy, items, notes)
            val result = requestRepository.submitToolTransfer(transfer)
            if (result.isFailure) {
                _submitState.value = UiState.Error(
                    result.exceptionOrNull()?.message ?: "Submission failed. Try again."
                )
                return@launch
            }
            val docId = result.getOrThrow()
            if (photoUris.isNotEmpty()) {
                val uploadResult = photoUploadManager.uploadPhotos(
                    photoUris, "tool_transfers", docId
                )
                if (uploadResult.isSuccess) {
                    requestRepository.updatePhotoUrls(
                        "tool_transfers", docId, uploadResult.getOrThrow()
                    )
                }
            }
            _submitState.value = UiState.Success(docId)
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

    private fun handleResult(result: Result<String>) {
        _submitState.value = when {
            result.isSuccess -> UiState.Success(result.getOrThrow())
            else -> UiState.Error(
                result.exceptionOrNull()?.message ?: "Submission failed. Try again."
            )
        }
    }

    fun resetSubmitState() { _submitState.value = UiState.Empty }
}
