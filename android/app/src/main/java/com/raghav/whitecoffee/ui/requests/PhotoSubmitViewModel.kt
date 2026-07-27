package com.raghav.whitecoffee.ui.requests

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.raghav.whitecoffee.core.UiState
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.photo.PhotoPipeline
import com.raghav.whitecoffee.data.repository.RequestRepository
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/**
 * Shared submit pipeline for the four photo-bearing request forms.
 *
 * All four repeated the same orchestration — reserve a document id, wait only on local photo
 * compression, write the document, queue the upload, roll the cache back on failure — and
 * `TransferViewModel` repeated it twice more internally, once for material and once for tools.
 * Six copies of a sequence whose *order* is the correctness property (decision #10: submit the
 * document first, get the id, upload after, patch the urls) is six chances to reorder one.
 *
 * Subclasses supply only what actually differs: which collection, how to validate, and how to
 * write. The public surface of each subclass is unchanged, so no Fragment needed touching.
 */
abstract class PhotoSubmitViewModel(
    protected val requestRepository: RequestRepository,
    private val photos: PhotoPipeline,
    networkMonitor: NetworkMonitor,
) : ViewModel() {

    val isOnline: StateFlow<Boolean> = networkMonitor.isOnline
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), true)

    private val _submitState = MutableStateFlow<UiState<String>>(UiState.Empty)
    val submitState: StateFlow<UiState<String>> = _submitState.asStateFlow()

    /**
     * The document id reserved when photos were first picked. Held so the cached files and the
     * document that will own them agree — the cache is keyed by id, so re-deriving one at submit
     * time would orphan every file already compressed.
     */
    private var pendingDocId: String? = null
    private var cacheJob: Deferred<List<String>>? = null

    /**
     * Starts compressing [uris] in the background while the user is still filling the form.
     *
     * An empty list means the user removed everything, which cancels the in-flight compression
     * and releases the reserved id.
     */
    protected fun cachePhotos(collection: String, uris: List<Uri>) {
        cacheJob?.cancel()
        if (uris.isEmpty()) {
            cacheJob = null
            pendingDocId = null
            return
        }
        val docId = pendingDocId ?: requestRepository.newDocId(collection).also { pendingDocId = it }
        cacheJob = viewModelScope.async { photos.cache(uris, docId) }
    }

    /**
     * Validates, writes the document, then queues the photo upload.
     *
     * @param validate returns an error message, or null when the input is acceptable. Returning
     *        a message publishes it and writes nothing.
     * @param write persists the document under the given id and returns its id on success.
     *
     * Compression is awaited because it is local and usually already finished; the *upload* never
     * is, so a submission completes at the same speed with or without a connection. A compression
     * failure degrades to submitting without photos rather than losing the report — the document
     * carries the field data, the photos are supporting evidence.
     */
    protected fun submit(
        collection: String,
        photoUris: List<Uri>,
        validate: () -> String?,
        write: suspend (docId: String) -> Result<String>,
    ) {
        validate()?.let {
            _submitState.value = UiState.Error(it)
            return
        }
        _submitState.value = UiState.Loading()
        viewModelScope.launch {
            try {
                val docId = pendingDocId ?: requestRepository.newDocId(collection)
                val cachedPaths = try {
                    cacheJob?.await()
                        ?: if (photoUris.isNotEmpty()) photos.cache(photoUris, docId) else emptyList()
                } catch (_: Exception) {
                    emptyList()
                }

                val result = write(docId)
                _submitState.value = if (result.isSuccess) {
                    // Only after the document exists — an upload against a document that was
                    // never written would retry three times and then drop the photos silently.
                    photos.scheduleUpload(collection, docId, cachedPaths)
                    UiState.Success(result.getOrThrow())
                } else {
                    photos.discard(docId)
                    UiState.Error(
                        result.exceptionOrNull()?.message ?: "Submission failed. Try again."
                    )
                }
            } catch (e: Exception) {
                _submitState.value = UiState.Error("Submission failed: ${e.message}")
            } finally {
                cacheJob = null
                pendingDocId = null
            }
        }
    }

    fun resetSubmitState() {
        _submitState.value = UiState.Empty
    }
}
