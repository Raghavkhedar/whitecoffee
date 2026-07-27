package com.raghav.whitecoffee.data.photo

import android.net.Uri
import androidx.work.WorkManager
import com.raghav.whitecoffee.data.PhotoUploadManager
import com.raghav.whitecoffee.data.worker.PhotoUploadWorker
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [PhotoPipeline] backed by [PhotoUploadManager] for compression and WorkManager for the upload.
 *
 * The only class that knows a background worker is involved. Bound to the interface in
 * [com.raghav.whitecoffee.di.DataSourceModule].
 */
@Singleton
class WorkManagerPhotoPipeline @Inject constructor(
    private val photoUploadManager: PhotoUploadManager,
    private val workManager: WorkManager,
) : PhotoPipeline {

    override suspend fun cache(uris: List<Uri>, docId: String): List<String> =
        photoUploadManager.cachePhotos(uris, docId)

    override fun scheduleUpload(collectionName: String, docId: String, cachedPaths: List<String>) {
        if (cachedPaths.isEmpty()) return
        workManager.enqueue(PhotoUploadWorker.buildRequest(collectionName, docId, cachedPaths))
    }

    override fun discard(docId: String) = photoUploadManager.clearCachedPhotos(docId)
}
