package com.raghav.whitecoffee.data.photo

import android.net.Uri

/**
 * The photo side of a submission, as the ViewModels actually use it.
 *
 * WHY THIS IS AN INTERFACE: the four request ViewModels injected `PhotoUploadManager` and
 * `WorkManager` directly, and both need an `@ApplicationContext Context`. That is why those four
 * were the last ViewModels that still could not be constructed on a JVM test runner, and so the
 * only ones with no tests — including the submit path, which decides whether a field report
 * reaches Firestore at all.
 *
 * It is deliberately ONE seam rather than two. A ViewModel has no interest in WorkManager; it
 * wants "hold these photos for this document, and get them uploaded eventually". Splitting that
 * into a cache contract and a scheduler contract would push the ordering rule — write the
 * document first, upload after — back out into every caller.
 *
 * `PhotoUploadManager` stays concrete for [com.raghav.whitecoffee.data.worker.PhotoUploadWorker],
 * which does the actual Storage upload and is instrumented-test territory either way.
 */
interface PhotoPipeline {

    /**
     * Compresses [uris] to disk under [docId] and returns the cached file paths.
     *
     * Runs while the user is still filling the form so that submit stays instant. Never touches
     * the network — compression is local, and the upload is [scheduleUpload]'s job.
     */
    suspend fun cache(uris: List<Uri>, docId: String): List<String>

    /**
     * Queues [cachedPaths] for upload against `{collectionName}/{docId}`.
     *
     * Called only AFTER the document write succeeds, so a failed submission never leaves an
     * upload pointing at a document that does not exist. The work is constrained on network and
     * persisted by WorkManager, so it survives navigation, process death and a reboot.
     */
    fun scheduleUpload(collectionName: String, docId: String, cachedPaths: List<String>)

    /** Drops the cached files for [docId]. Called when the submission failed. */
    fun discard(docId: String)
}
