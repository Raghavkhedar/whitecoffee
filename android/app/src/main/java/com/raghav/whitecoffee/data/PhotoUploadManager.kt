package com.raghav.whitecoffee.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.google.firebase.storage.FirebaseStorage
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PhotoUploadManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val storage: FirebaseStorage,
    private val sessionManager: SessionManager
) {

    companion object {
        private const val MAX_DIMENSION = 720     // H4: field photos viewed on small screens
        private const val JPEG_QUALITY  = 60      // H4: ~80KB vs ~200KB, no perceptible quality loss
        private const val MAX_CONCURRENT = 3      // M2: cap concurrent uploads for better throughput
    }

    /**
     * Compresses + uploads a list of photo URIs to Firebase Storage.
     * Returns list of HTTPS download URLs to save in Firestore.
     * [onProgress] is invoked after each photo completes with (completedCount, totalCount).
     *
     * Storage path: requests/{userId}/{collectionName}/{docId}/{timestamp}.jpg
     */
    suspend fun uploadPhotos(
        uris: List<Uri>,
        collectionName: String,
        docId: String,
        onProgress: ((current: Int, total: Int) -> Unit)? = null
    ): Result<List<String>> {
        return try {
            val total = uris.size
            val completed = AtomicInteger(0)
            val semaphore = Semaphore(MAX_CONCURRENT)
            val urls = coroutineScope {
                uris.map { uri ->
                    async {
                        semaphore.withPermit {
                            val url = uploadSinglePhoto(uri, collectionName, docId)
                            onProgress?.invoke(completed.incrementAndGet(), total)
                            url
                        }
                    }
                }.awaitAll()
            }
            Result.success(urls)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private suspend fun uploadSinglePhoto(
        uri: Uri,
        collectionName: String,
        docId: String
    ): String {
        // H1: Bitmap decode/compress is CPU-bound — use Default dispatcher
        val compressed = withContext(Dispatchers.Default) { compressImage(uri) }

        val timestamp = System.currentTimeMillis()
        val path = "requests/${sessionManager.userId}/$collectionName/$docId/$timestamp.jpg"

        // H2: Return full HTTPS download URL, not the raw storage path
        val ref = storage.reference.child(path)
        ref.putBytes(compressed).await()
        return ref.getDownloadUrl().await().toString()
    }

    /**
     * Decodes the image already downsampled (inSampleSize) so we never load a full
     * 12MP camera bitmap into memory — far faster + lower memory than decoding full then scaling.
     */
    private fun compressImage(uri: Uri): ByteArray {
        // Pass 1 — read only the dimensions, no pixel allocation
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        val stream1 = context.contentResolver.openInputStream(uri)
            ?: throw Exception("Cannot read image.")
        stream1.use { BitmapFactory.decodeStream(it, null, bounds) }

        // Pass 2 — decode downsampled to roughly the target size
        val opts = BitmapFactory.Options().apply {
            inSampleSize = calculateInSampleSize(bounds.outWidth, bounds.outHeight)
        }
        val decoded = context.contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, opts)
        } ?: throw Exception("Cannot read image.")

        val scaled = resizeBitmap(decoded)

        val output = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)

        if (scaled != decoded) scaled.recycle()
        decoded.recycle()

        return output.toByteArray()
    }

    /** Largest power-of-two sample size that keeps both sides >= MAX_DIMENSION. */
    private fun calculateInSampleSize(width: Int, height: Int): Int {
        var sample = 1
        var w = width
        var h = height
        while (w / 2 >= MAX_DIMENSION && h / 2 >= MAX_DIMENSION) {
            w /= 2
            h /= 2
            sample *= 2
        }
        return sample
    }

    private fun resizeBitmap(bitmap: Bitmap): Bitmap {
        val width  = bitmap.width
        val height = bitmap.height

        if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) return bitmap

        val ratio = width.toFloat() / height.toFloat()
        val (newWidth, newHeight) = if (width > height) {
            MAX_DIMENSION to (MAX_DIMENSION / ratio).toInt()
        } else {
            (MAX_DIMENSION * ratio).toInt() to MAX_DIMENSION
        }

        return Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true)
    }

    // ── WorkManager retry support ──────────────────────────────────────────

    /**
     * Compresses each URI and writes the JPEG bytes to internal storage so they survive
     * an app-process kill. Returns the absolute file paths (input to [uploadCachedFiles]).
     *
     * Runs on Dispatchers.IO — safe to call from a viewModelScope.async.
     */
    suspend fun cachePhotos(uris: List<Uri>, docId: String): List<String> =
        withContext(Dispatchers.IO) {
            val dir = File(context.filesDir, "photo_cache/$docId").also { it.mkdirs() }
            uris.mapIndexed { i, uri ->
                val bytes = compressImage(uri)
                val file = File(dir, "$i.jpg")
                file.writeBytes(bytes)
                file.absolutePath
            }
        }

    /**
     * Uploads already-compressed JPEG files (written by [cachePhotos]) to Firebase Storage.
     * Used by [PhotoUploadWorker] — reads from internal storage so no live Uri needed.
     */
    suspend fun uploadCachedFiles(
        filePaths: List<String>,
        collectionName: String,
        docId: String
    ): Result<List<String>> = try {
        val semaphore = Semaphore(MAX_CONCURRENT)
        val urls = coroutineScope {
            filePaths.mapIndexed { i, path ->
                async {
                    semaphore.withPermit {
                        val bytes = withContext(Dispatchers.IO) { File(path).readBytes() }
                        val storagePath = "requests/${sessionManager.userId}/$collectionName/$docId/${i}_${System.currentTimeMillis()}.jpg"
                        val ref = storage.reference.child(storagePath)
                        ref.putBytes(bytes).await()
                        ref.getDownloadUrl().await().toString()
                    }
                }
            }.awaitAll()
        }
        Result.success(urls)
    } catch (e: Exception) {
        Result.failure(e)
    }

    fun clearCachedPhotos(docId: String) {
        File(context.filesDir, "photo_cache/$docId").deleteRecursively()
    }
}
