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
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers
import java.io.ByteArrayOutputStream
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PhotoUploadManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val storage: FirebaseStorage,
    private val sessionManager: SessionManager
) {

    companion object {
        private const val MAX_DIMENSION = 1080    // px — longest side
        private const val JPEG_QUALITY  = 75      // % — enough for field photos
    }

    /**
     * Compresses + uploads a list of photo URIs to Firebase Storage.
     * Returns list of download URLs to save in Firestore.
     *
     * Storage path: requests/{userId}/{collectionName}/{docId}/{timestamp}.jpg
     */
    suspend fun uploadPhotos(
        uris: List<Uri>,
        collectionName: String,
        docId: String
    ): Result<List<String>> {
        return try {
            val urls = coroutineScope {
                uris.map { uri ->
                    async { uploadSinglePhoto(uri, collectionName, docId) }
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
        // Step 1 — Compress on IO thread (bitmap decode is CPU + I/O heavy)
        val compressed = withContext(Dispatchers.IO) { compressImage(uri) }

        // Step 2 — Build storage path
        val timestamp = System.currentTimeMillis()
        val path = "requests/${sessionManager.userId}/$collectionName/$docId/$timestamp.jpg"

        // Step 3 — Upload and return the path (no extra getDownloadUrl round-trip)
        storage.reference.child(path).putBytes(compressed).await()
        return path
    }

    /**
     * Resizes image to max 1080px on longest side + compresses to JPEG 75%.
     * Reduces 3-5MB raw photos to ~150-250KB while keeping clarity.
     */
    private fun compressImage(uri: Uri): ByteArray {
        val inputStream = context.contentResolver.openInputStream(uri)
            ?: throw Exception("Cannot read image.")

        val original = BitmapFactory.decodeStream(inputStream)
        inputStream.close()

        val compressed = resizeBitmap(original)

        val output = ByteArrayOutputStream()
        compressed.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)

        if (compressed != original) compressed.recycle()
        original.recycle()

        return output.toByteArray()
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
}