package com.raghav.whitecoffee.data.worker

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.raghav.whitecoffee.data.PhotoUploadManager
import com.raghav.whitecoffee.data.repository.RequestRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import java.time.Duration

/**
 * Uploads cached JPEG files to Firebase Storage and patches the Firestore doc's photoUrls.
 *
 * Triggered when the in-process photo upload fails (network drop, app kill mid-upload).
 * Input: collection name, doc ID, pipe-separated list of absolute cached file paths.
 * Constraint: REQUIRES_NETWORK — waits until connectivity returns before each attempt.
 * Retry: exponential backoff starting at 30 s, capped at 3 total attempts by WorkManager default.
 */
@HiltWorker
class PhotoUploadWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val photoUploadManager: PhotoUploadManager,
    private val requestRepository: RequestRepository
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val collection = inputData.getString(KEY_COLLECTION) ?: return Result.failure()
        val docId      = inputData.getString(KEY_DOC_ID)     ?: return Result.failure()
        val paths = inputData.getString(KEY_FILE_PATHS)
            ?.split("|")
            ?.filter { it.isNotBlank() }
            .takeIf { !it.isNullOrEmpty() } ?: return Result.failure()

        val uploadResult = photoUploadManager.uploadCachedFiles(paths, collection, docId)
        if (uploadResult.isFailure) {
            return if (runAttemptCount < MAX_ATTEMPTS - 1) Result.retry() else Result.failure()
        }

        val urls = uploadResult.getOrThrow()
        requestRepository.updatePhotoUrls(collection, docId, urls)
        photoUploadManager.clearCachedPhotos(docId)
        return Result.success()
    }

    companion object {
        const val KEY_COLLECTION = "collection"
        const val KEY_DOC_ID     = "doc_id"
        const val KEY_FILE_PATHS = "file_paths"
        private const val MAX_ATTEMPTS = 3

        fun buildRequest(
            collection: String,
            docId: String,
            filePaths: List<String>
        ): OneTimeWorkRequest =
            OneTimeWorkRequestBuilder<PhotoUploadWorker>()
                .setInputData(workDataOf(
                    KEY_COLLECTION to collection,
                    KEY_DOC_ID     to docId,
                    KEY_FILE_PATHS to filePaths.joinToString("|")
                ))
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, Duration.ofSeconds(30))
                .addTag("photo_upload_$docId")
                .build()
    }
}
