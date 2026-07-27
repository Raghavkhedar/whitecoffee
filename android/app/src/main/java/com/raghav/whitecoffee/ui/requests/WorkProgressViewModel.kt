package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import com.raghav.whitecoffee.data.model.WorkProgress
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.photo.PhotoPipeline
import com.raghav.whitecoffee.data.repository.RequestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class WorkProgressViewModel @Inject constructor(
    requestRepository: RequestRepository,
    photos: PhotoPipeline,
    networkMonitor: NetworkMonitor,
) : PhotoSubmitViewModel(requestRepository, photos, networkMonitor) {

    fun onPhotosChanged(uris: List<Uri>) = cachePhotos(COLLECTION, uris)

    fun submitProgress(
        siteId: String,
        siteName: String,
        date: String,
        workDescription: String,
        photoUris: List<Uri> = emptyList(),
    ) = submit(
        collection = COLLECTION,
        photoUris = photoUris,
        validate = {
            if (workDescription.isBlank()) "Please enter a work description." else null
        },
        write = { docId ->
            requestRepository.submitWorkProgress(
                WorkProgress(
                    siteId          = siteId.trim(),
                    siteName        = siteName.trim(),
                    date            = date,
                    workDescription = workDescription.trim(),
                ),
                docId,
                // Written with empty photoUrls; the worker patches them in once uploaded.
                emptyList(),
            )
        },
    )

    private companion object {
        const val COLLECTION = "work_progress"
    }
}
