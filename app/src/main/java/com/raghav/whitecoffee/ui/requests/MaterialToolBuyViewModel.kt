package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.PhotoUploadManager
import com.raghav.whitecoffee.data.model.MaterialToolPurchase
import com.raghav.whitecoffee.data.model.PurchaseItem
import com.raghav.whitecoffee.data.repository.RequestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

// SiteRepository + SiteTask removed — site is now entered as free text by the user.
// To re-enable: add SiteRepository injection, restore _sitesState + loadSites(),
// change submitPurchase() back to accept SiteTask.

@HiltViewModel
class MaterialToolBuyViewModel @Inject constructor(
    private val requestRepository: RequestRepository,
    private val photoUploadManager: PhotoUploadManager
) : ViewModel() {

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    fun submitPurchase(
        siteId: String,
        siteName: String,
        items: List<PurchaseItem>,
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
        _submitState.value = UiState.Loading
        viewModelScope.launch {
            val grandTotal = items.sumOf { it.totalPrice }
            val purchase = MaterialToolPurchase(
                siteId     = siteId.trim(),
                siteName   = siteName.trim(),
                items      = items,
                grandTotal = grandTotal,
                notes      = notes.trim()
            )
            val result = requestRepository.submitMaterialToolPurchase(purchase)
            if (result.isFailure) {
                _submitState.value = UiState.Error(
                    result.exceptionOrNull()?.message ?: "Submission failed. Try again."
                )
                return@launch
            }
            val docId = result.getOrThrow()
            if (photoUris.isNotEmpty()) {
                val uploadResult = photoUploadManager.uploadPhotos(
                    photoUris, "material_purchases", docId
                )
                if (uploadResult.isSuccess) {
                    requestRepository.updatePhotoUrls(
                        "material_purchases", docId, uploadResult.getOrThrow()
                    )
                }
            }
            _submitState.value = UiState.Success(docId)
        }
    }

    fun resetSubmitState() { _submitState.value = UiState.Empty }
}
