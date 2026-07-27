package com.raghav.whitecoffee.fake

import android.net.Uri
import com.raghav.whitecoffee.data.photo.PhotoPipeline

/**
 * In-memory [PhotoPipeline] for unit tests.
 *
 * Records the order of operations, which is what the request ViewModels are actually being
 * tested on: the document must be written before an upload is scheduled, and a failed write
 * must discard the cache rather than schedule anything.
 */
class FakePhotoPipeline : PhotoPipeline {

    /** One cached path per uri handed to [cache], unless [cacheFails]. */
    var cachedPaths: List<String> = emptyList()
        private set

    /** Uploads scheduled, as (collection, docId, paths). */
    val scheduled = mutableListOf<Triple<String, String, List<String>>>()

    /** Doc ids whose cache was discarded. */
    val discarded = mutableListOf<String>()

    /** When set, [cache] throws — the "compression failed" branch. */
    var cacheFails: Exception? = null

    override suspend fun cache(uris: List<Uri>, docId: String): List<String> {
        cacheFails?.let { throw it }
        cachedPaths = uris.indices.map { "/cache/$docId/$it.jpg" }
        return cachedPaths
    }

    override fun scheduleUpload(
        collectionName: String,
        docId: String,
        cachedPaths: List<String>
    ) {
        if (cachedPaths.isEmpty()) return
        scheduled += Triple(collectionName, docId, cachedPaths)
    }

    override fun discard(docId: String) {
        discarded += docId
    }
}
