package com.raghav.whitecoffee.ui.requests

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.MaterialToolPurchase
import com.raghav.whitecoffee.data.model.PurchaseItem
import com.raghav.whitecoffee.data.model.Site
import com.raghav.whitecoffee.data.repository.RequestRepository
import com.raghav.whitecoffee.data.repository.SiteRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MaterialToolBuyViewModel @Inject constructor(
    private val requestRepository: RequestRepository,
    private val siteRepository: SiteRepository
) : ViewModel() {

    private val _sitesState = MutableStateFlow<UiState<List<Site>>>(UiState.Loading)
    val sitesState: StateFlow<UiState<List<Site>>> = _sitesState.asStateFlow()

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    init { loadSites() }

    private fun loadSites() {
        viewModelScope.launch {
            _sitesState.value = UiState.Loading
            val result = siteRepository.getAssignedSites()
            _sitesState.value = when {
                result.isSuccess -> {
                    val sites = result.getOrThrow()
                    if (sites.isEmpty()) UiState.Empty else UiState.Success(sites)
                }
                else -> UiState.Error("Failed to load sites.")
            }
        }
    }

    fun submitPurchase(site: Site, items: List<PurchaseItem>, notes: String) {
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
                siteId     = site.id,
                siteName   = site.name,
                items      = items,
                grandTotal = grandTotal,
                notes      = notes.trim()
            )
            val result = requestRepository.submitMaterialToolPurchase(purchase)
            _submitState.value = when {
                result.isSuccess -> UiState.Success(result.getOrThrow())
                else -> UiState.Error(
                    result.exceptionOrNull()?.message ?: "Submission failed. Try again."
                )
            }
        }
    }

    fun resetSubmitState() { _submitState.value = UiState.Empty }
}