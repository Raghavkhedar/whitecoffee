package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import com.raghav.whitecoffee.data.model.MaterialToolRequest
import com.raghav.whitecoffee.data.model.RequestItem
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.photo.PhotoPipeline
import com.raghav.whitecoffee.data.repository.RequestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class MaterialToolRequestViewModel @Inject constructor(
    requestRepository: RequestRepository,
    photos: PhotoPipeline,
    networkMonitor: NetworkMonitor,
) : PhotoSubmitViewModel(requestRepository, photos, networkMonitor) {

    fun onPhotosChanged(uris: List<Uri>) = cachePhotos(COLLECTION, uris)

    fun submitRequest(
        siteId: String,
        siteName: String,
        items: List<RequestItem>,
        notes: String,
        photoUris: List<Uri> = emptyList(),
    ) = submit(
        collection = COLLECTION,
        photoUris = photoUris,
        validate = { validateItems(items) },
        write = { docId ->
            requestRepository.submitMaterialToolRequest(
                MaterialToolRequest(
                    siteId   = siteId.trim(),
                    siteName = siteName.trim(),
                    items    = items,
                    notes    = notes.trim(),
                ),
                docId,
                // Written with empty photoUrls; the worker patches them in once uploaded.
                emptyList(),
            )
        },
    )

    private companion object {
        const val COLLECTION = "material_requests"

        fun validateItems(items: List<RequestItem>): String? = when {
            items.isEmpty() -> "Please add at least one item."
            items.any { it.itemName.isBlank() || it.quantity <= 0 } ->
                "Please fill in all item names and quantities."
            else -> null
        }
    }
}
