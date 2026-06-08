package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.raghav.whitecoffee.data.model.MaterialToolPurchase
import com.raghav.whitecoffee.data.model.MaterialToolRequest
import com.raghav.whitecoffee.data.model.Transfer
import com.raghav.whitecoffee.data.model.WorkProgress
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RequestRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) {

    // ── Collection references (sub-collections under the current user's doc) ──
    private val userDoc         get() = firestore.collection("users").document(sessionManager.userId)
    private val mtRequestCol    get() = userDoc.collection("material_requests")
    private val mtPurchaseCol   get() = userDoc.collection("material_purchases")
    private val matTransferCol  get() = userDoc.collection("material_transfers")
    private val toolTransferCol get() = userDoc.collection("tool_transfers")
    private val workProgressCol get() = userDoc.collection("work_progress")

    /**
     * Generates a document ID locally (no network call). Lets the caller upload photos
     * to the doc's storage path BEFORE the doc is written, so the photo URLs can be
     * included in a single write instead of write-then-update.
     */
    fun newDocId(collectionName: String): String =
        userDoc.collection(collectionName).document().id

    // ── M&T Request ────────────────────────────────────────────────────────

    suspend fun submitMaterialToolRequest(
        request: MaterialToolRequest,
        docId: String? = null,
        photoUrls: List<String> = emptyList()
    ): Result<String> {
        return try {
            if (request.items.isEmpty()) {
                return Result.failure(Exception("Please add at least one item."))
            }
            val data = request.copy(
                userId     = sessionManager.userId,
                userName   = sessionManager.name,
                employeeId = sessionManager.employeeId,
                photoUrls  = photoUrls,
                submittedAt = Timestamp.now()
            )
            val ref = if (docId != null) mtRequestCol.document(docId) else mtRequestCol.document()
            ref.set(data.toMap()).await()
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getMaterialToolRequests(): Result<List<MaterialToolRequest>> {
        return try {
            val snapshot = mtRequestCol
                .orderBy("submittedAt", Query.Direction.DESCENDING)
                .get()
                .await()
            Result.success(snapshot.documents.mapNotNull { MaterialToolRequest.fromDocument(it) })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ── M&T Purchase ───────────────────────────────────────────────────────

    suspend fun submitMaterialToolPurchase(
        purchase: MaterialToolPurchase,
        docId: String? = null,
        photoUrls: List<String> = emptyList()
    ): Result<String> {
        return try {
            if (purchase.items.isEmpty()) {
                return Result.failure(Exception("Please add at least one item."))
            }
            val data = purchase.copy(
                userId      = sessionManager.userId,
                userName    = sessionManager.name,
                employeeId  = sessionManager.employeeId,
                photoUrls   = photoUrls,
                submittedAt = Timestamp.now()
            )
            val ref = if (docId != null) mtPurchaseCol.document(docId) else mtPurchaseCol.document()
            ref.set(data.toMap()).await()
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getMaterialToolPurchases(): Result<List<MaterialToolPurchase>> {
        return try {
            val snapshot = mtPurchaseCol
                .orderBy("submittedAt", Query.Direction.DESCENDING)
                .get()
                .await()
            Result.success(snapshot.documents.mapNotNull { MaterialToolPurchase.fromDocument(it) })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ── Material Transfer ──────────────────────────────────────────────────

    suspend fun submitMaterialTransfer(
        transfer: Transfer,
        docId: String? = null,
        photoUrls: List<String> = emptyList()
    ): Result<String> {
        return try {
            if (transfer.items.isEmpty()) {
                return Result.failure(Exception("Please add at least one item."))
            }
            val data = transfer.copy(
                userId      = sessionManager.userId,
                userName    = sessionManager.name,
                employeeId  = sessionManager.employeeId,
                photoUrls   = photoUrls,
                submittedAt = Timestamp.now()
            )
            val ref = if (docId != null) matTransferCol.document(docId) else matTransferCol.document()
            ref.set(data.toMap()).await()
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getMaterialTransfers(): Result<List<Transfer>> {
        return try {
            val snapshot = matTransferCol
                .orderBy("submittedAt", Query.Direction.DESCENDING)
                .get()
                .await()
            Result.success(snapshot.documents.mapNotNull { Transfer.fromDocument(it) })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ── Tool Transfer ──────────────────────────────────────────────────────

    suspend fun submitToolTransfer(
        transfer: Transfer,
        docId: String? = null,
        photoUrls: List<String> = emptyList()
    ): Result<String> {
        return try {
            if (transfer.items.isEmpty()) {
                return Result.failure(Exception("Please add at least one item."))
            }
            val data = transfer.copy(
                userId      = sessionManager.userId,
                userName    = sessionManager.name,
                employeeId  = sessionManager.employeeId,
                photoUrls   = photoUrls,
                submittedAt = Timestamp.now()
            )
            val ref = if (docId != null) toolTransferCol.document(docId) else toolTransferCol.document()
            ref.set(data.toMap()).await()
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getToolTransfers(): Result<List<Transfer>> {
        return try {
            val snapshot = toolTransferCol
                .orderBy("submittedAt", Query.Direction.DESCENDING)
                .get()
                .await()
            Result.success(snapshot.documents.mapNotNull { Transfer.fromDocument(it) })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ── Work Progress ──────────────────────────────────────────────────────

    suspend fun submitWorkProgress(
        progress: WorkProgress,
        docId: String? = null,
        photoUrls: List<String> = emptyList()
    ): Result<String> {
        return try {
            if (progress.workDescription.isBlank()) {
                return Result.failure(Exception("Please add a work description."))
            }
            val data = progress.copy(
                userId      = sessionManager.userId,
                userName    = sessionManager.name,
                employeeId  = sessionManager.employeeId,
                photoUrls   = photoUrls,
                submittedAt = Timestamp.now()
            )
            val ref = if (docId != null) workProgressCol.document(docId) else workProgressCol.document()
            ref.set(data.toMap()).await()
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun updatePhotoUrls(
        collectionName: String,
        docId: String,
        urls: List<String>
    ): Result<Unit> {
        return try {
            userDoc.collection(collectionName).document(docId)
                .update("photoUrls", urls)
                .await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getWorkProgress(): Result<List<WorkProgress>> {
        return try {
            val snapshot = workProgressCol
                .orderBy("submittedAt", Query.Direction.DESCENDING)
                .get()
                .await()
            Result.success(snapshot.documents.mapNotNull { WorkProgress.fromDocument(it) })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}