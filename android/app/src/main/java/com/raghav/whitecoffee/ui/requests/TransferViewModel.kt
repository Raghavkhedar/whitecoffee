package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import com.raghav.whitecoffee.data.model.Transfer
import com.raghav.whitecoffee.data.model.TransferItem
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.photo.PhotoPipeline
import com.raghav.whitecoffee.data.repository.RequestRepository
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
) : PhotoSubmitViewModel(requestRepository, photos, networkMonitor) {

    // The collection is chosen by the host Fragment, so it is a parameter here rather than a
    // constant like the single-purpose forms.
    fun onPhotosChanged(collection: String, uris: List<Uri>) = cachePhotos(collection, uris)

    fun submitMaterialTransfer(
        fromLocation: String,
        toLocation: String,
        transferredBy: String,
        receivedBy: String,
        items: List<TransferItem>,
        notes: String,
        photoUris: List<Uri> = emptyList(),
    ) = submitTransfer(
        MATERIAL_TRANSFERS, fromLocation, toLocation, transferredBy, receivedBy, items, notes, photoUris,
    ) { docId, transfer -> requestRepository.submitMaterialTransfer(transfer, docId, emptyList()) }

    fun submitToolTransfer(
        fromLocation: String,
        toLocation: String,
        transferredBy: String,
        receivedBy: String,
        items: List<TransferItem>,
        notes: String,
        photoUris: List<Uri> = emptyList(),
    ) = submitTransfer(
        TOOL_TRANSFERS, fromLocation, toLocation, transferredBy, receivedBy, items, notes, photoUris,
    ) { docId, transfer -> requestRepository.submitToolTransfer(transfer, docId, emptyList()) }

    private fun submitTransfer(
        collection: String,
        from: String,
        to: String,
        transferredBy: String,
        receivedBy: String,
        items: List<TransferItem>,
        notes: String,
        photoUris: List<Uri>,
        write: suspend (docId: String, transfer: Transfer) -> Result<String>,
    ) = submit(
        collection = collection,
        photoUris = photoUris,
        validate = { validateInputs(from, to, transferredBy, receivedBy, items) },
        write = { docId ->
            write(
                docId,
                Transfer(
                    fromLocation  = from.trim(),
                    toLocation    = to.trim(),
                    transferredBy = transferredBy.trim(),
                    receivedBy    = receivedBy.trim(),
                    items         = items,
                    notes         = notes.trim(),
                    transferDate  = LocalDate.now().format(DATE_FORMAT),
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
            receivedBy: String,
            items: List<TransferItem>,
        ): String? = when {
            from.isBlank() -> "Please enter the from location."
            to.isBlank() -> "Please enter the to location."
            transferredBy.isBlank() -> "Please enter who is transferring."
            receivedBy.isBlank() -> "Please enter who is receiving."
            items.isEmpty() -> "Please add at least one item."
            items.any { it.itemName.isBlank() || it.quantity <= 0 } ->
                "Please fill in all item names and quantities."
            else -> null
        }
    }
}
