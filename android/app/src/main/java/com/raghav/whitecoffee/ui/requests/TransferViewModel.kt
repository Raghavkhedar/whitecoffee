package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.data.model.Employee
import com.raghav.whitecoffee.data.model.Transfer
import com.raghav.whitecoffee.data.model.TransferItem
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.photo.PhotoPipeline
import com.raghav.whitecoffee.data.repository.RequestRepository
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import javax.inject.Inject

/**
 * Backs both transfer screens. Material and tool transfers share a model and a form and differ
 * only in the collection they land in — which is why the two submit methods had been full copies
 * of each other on top of the copy they already shared with the other three request ViewModels.
 */
@HiltViewModel
class TransferViewModel @Inject constructor(
    requestRepository: RequestRepository,
    photos: PhotoPipeline,
    networkMonitor: NetworkMonitor,
    private val sessionManager: SessionManager,
) : PhotoSubmitViewModel(requestRepository, photos, networkMonitor) {

    private val _employees = MutableStateFlow<List<Employee>?>(null)

    /** Who a transfer can be addressed to; null while still loading. */
    val employees: StateFlow<List<Employee>?> = _employees.asStateFlow()

    init { loadEmployees() }

    fun loadEmployees() {
        _employees.value = null
        viewModelScope.launch {
            _employees.value = requestRepository.getDirectory().getOrDefault(emptyList())
                .filter { it.active && it.uid != sessionManager.userId }
                .sortedBy { it.name.lowercase() }
        }
    }

    // The collection is chosen by the host Fragment, so it is a parameter here rather than a
    // constant like the single-purpose forms.
    fun onPhotosChanged(collection: String, uris: List<Uri>) = cachePhotos(collection, uris)

    fun submitMaterialTransfer(
        fromLocation: String,
        toLocation: String,
        transferredBy: String,
        receiver: Employee?,
        items: List<TransferItem>,
        notes: String,
        photoUris: List<Uri> = emptyList(),
        date: LocalDate = LocalDate.now(),
    ) = submitTransfer(
        MATERIAL_TRANSFERS, fromLocation, toLocation, transferredBy, receiver, items, notes, photoUris, date,
    ) { docId, transfer -> requestRepository.submitMaterialTransfer(transfer, docId, emptyList()) }

    fun submitToolTransfer(
        fromLocation: String,
        toLocation: String,
        transferredBy: String,
        receiver: Employee?,
        items: List<TransferItem>,
        notes: String,
        photoUris: List<Uri> = emptyList(),
        date: LocalDate = LocalDate.now(),
    ) = submitTransfer(
        TOOL_TRANSFERS, fromLocation, toLocation, transferredBy, receiver, items, notes, photoUris, date,
    ) { docId, transfer -> requestRepository.submitToolTransfer(transfer, docId, emptyList()) }

    private fun submitTransfer(
        collection: String,
        from: String,
        to: String,
        transferredBy: String,
        receiver: Employee?,
        items: List<TransferItem>,
        notes: String,
        photoUris: List<Uri>,
        date: LocalDate,
        write: suspend (docId: String, transfer: Transfer) -> Result<String>,
    ) = submit(
        collection = collection,
        photoUris = photoUris,
        validate = { validateInputs(from, to, transferredBy, receiver, items) },
        write = { docId ->
            write(
                docId,
                Transfer(
                    fromLocation  = from.trim(),
                    toLocation    = to.trim(),
                    transferredBy = transferredBy.trim(),
                    receivedBy    = receiver!!.name,
                    receiverId    = receiver.uid,
                    receiptStatus = "pending",
                    items         = items,
                    notes         = notes.trim(),
                    transferDate  = date.format(DATE_FORMAT),
                ),
            )
        },
    )

    private companion object {
        const val MATERIAL_TRANSFERS = "material_transfers"
        const val TOOL_TRANSFERS = "tool_transfers"

        private val DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd")

        fun validateInputs(
            from: String,
            to: String,
            transferredBy: String,
            receiver: Employee?,
            items: List<TransferItem>,
        ): String? = when {
            from.isBlank() -> "Please enter the from location."
            to.isBlank() -> "Please enter the to location."
            transferredBy.isBlank() -> "Please enter who is transferring."
            receiver == null -> "Please choose who is receiving."
            items.isEmpty() -> "Please add at least one item."
            items.any { it.itemName.isBlank() || it.quantity <= 0 } ->
                "Please fill in all item names and quantities."
            else -> null
        }
    }
}
