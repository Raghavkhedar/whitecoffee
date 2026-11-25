package com.raghav.whitecoffee.ui.requests

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.model.IncomingTransfer
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.repository.RequestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Transfers sent to this employee that are still open: confirm them or report a problem. */
@HiltViewModel
class IncomingTransfersViewModel @Inject constructor(
    private val repository: RequestRepository,
    networkMonitor: NetworkMonitor,
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    val state: StateFlow<UiState<List<IncomingTransfer>>> = repository.observeIncomingTransfers()
        .map { result ->
            result.fold(
                onSuccess = { all ->
                    val open = all.filter { it.transfer.receiptStatus != "received" }
                        .sortedByDescending { it.transfer.submittedAt?.seconds ?: 0L }
                    if (open.isEmpty()) UiState.Empty else UiState.Success(open)
                },
                onFailure = { UiState.Error(it.message ?: "Could not load transfers.") },
            )
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), UiState.Loading())

    fun confirm(item: IncomingTransfer) = answer(item, "received", "")

    fun reportProblem(item: IncomingTransfer, note: String) {
        val trimmed = note.trim()
        if (trimmed.isNotEmpty()) answer(item, "problem", trimmed)
    }

    private fun answer(item: IncomingTransfer, status: String, note: String) {
        viewModelScope.launch {
            repository.confirmReceipt(
                item.collection, item.transfer.userId, item.transfer.id, status, note,
            )
        }
    }
}
