package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.raghav.whitecoffee.data.firestore.AuditStamp
import com.raghav.whitecoffee.data.firestore.withAuditStamp
import com.raghav.whitecoffee.data.model.Employee
import com.raghav.whitecoffee.data.model.IncomingTransfer
import com.raghav.whitecoffee.data.model.MaterialToolPurchase
import com.raghav.whitecoffee.data.model.MaterialToolRequest
import com.raghav.whitecoffee.data.model.Transfer
import com.raghav.whitecoffee.data.model.WorkProgress
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FirestoreRequestRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) : RequestRepository {

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
    override fun newDocId(collectionName: String): String =
        userDoc.collection(collectionName).document().id

    // ── M&T Request ────────────────────────────────────────────────────────

    override suspend fun submitMaterialToolRequest(
        request: MaterialToolRequest,
        docId: String?,
        photoUrls: List<String>
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
            // Stampable: the submission CREATE rule is isOwner + createdUnreviewed() (which
            // only inspects `status`), no hasOnly — extra fields are accepted.
            ref.set(data.toMap().withAuditStamp(AuditStamp.uid(sessionManager)))
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun getMaterialToolRequests(): Result<List<MaterialToolRequest>> {
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

    override suspend fun submitMaterialToolPurchase(
        purchase: MaterialToolPurchase,
        docId: String?,
        photoUrls: List<String>
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
            // Stampable: the submission CREATE rule is isOwner + createdUnreviewed() (which
            // only inspects `status`), no hasOnly — extra fields are accepted.
            ref.set(data.toMap().withAuditStamp(AuditStamp.uid(sessionManager)))
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun getMaterialToolPurchases(): Result<List<MaterialToolPurchase>> {
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

    override suspend fun submitMaterialTransfer(
        transfer: Transfer,
        docId: String?,
        photoUrls: List<String>
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
            // Stampable: the submission CREATE rule is isOwner + createdUnreviewed() (which
            // only inspects `status`), no hasOnly — extra fields are accepted.
            ref.set(data.toMap().withAuditStamp(AuditStamp.uid(sessionManager)))
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun getMaterialTransfers(): Result<List<Transfer>> {
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

    override suspend fun submitToolTransfer(
        transfer: Transfer,
        docId: String?,
        photoUrls: List<String>
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
            // Stampable: the submission CREATE rule is isOwner + createdUnreviewed() (which
            // only inspects `status`), no hasOnly — extra fields are accepted.
            ref.set(data.toMap().withAuditStamp(AuditStamp.uid(sessionManager)))
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun getToolTransfers(): Result<List<Transfer>> {
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

    // ── Transfer receipt ───────────────────────────────────────────────────

    // shortcut: held in memory, so a refusal arriving after the app was killed is not shown;
    // persist the queued answer if that turns out to happen.
    private val _receiptError = MutableStateFlow<String?>(null)
    override val receiptError: StateFlow<String?> = _receiptError
    override fun clearReceiptError() { _receiptError.value = null }

    override suspend fun getDirectory(): Result<List<Employee>> {
        return try {
            val snapshot = firestore.collection("directory").get().await()
            Result.success(snapshot.documents.map {
                Employee(
                    uid        = it.id,
                    name       = it.getString("name") ?: "",
                    employeeId = it.getString("employeeId") ?: "",
                    active     = it.getBoolean("active") ?: true,
                )
            })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override fun observeIncomingTransfers(): Flow<Result<List<IncomingTransfer>>> =
        combine(incoming("material_transfers"), incoming("tool_transfers")) { material, tool ->
            runCatching { material.getOrThrow() + tool.getOrThrow() }
        }

    // shortcut: listens to every transfer ever sent to this user; filter on receiptStatus
    // (with a composite index) once that list grows large.
    private fun incoming(collectionName: String): Flow<Result<List<IncomingTransfer>>> = callbackFlow {
        val registration = firestore.collectionGroup(collectionName)
            .whereEqualTo("receiverId", sessionManager.userId)
            .addSnapshotListener { snapshot, error ->
                trySend(
                    if (error != null) Result.failure(error)
                    else Result.success(snapshot?.documents.orEmpty().mapNotNull { doc ->
                        Transfer.fromDocument(doc)?.let { IncomingTransfer(collectionName, it) }
                    })
                )
            }
        awaitClose { registration.remove() }
    }

    // Not awaited: confirming at a site with no signal must work (see OfflineWritePolicyTest).
    override suspend fun confirmReceipt(
        collectionName: String,
        senderId: String,
        docId: String,
        status: String,
        note: String
    ): Result<Unit> {
        return try {
            val data = buildMap<String, Any> {
                put("receiptStatus", status)
                put("receiptAt", FieldValue.serverTimestamp())
                if (note.isNotEmpty()) put("receiptNote", note)
            }
            firestore.collection("users").document(senderId)
                .collection(collectionName).document(docId)
                .update(data.withAuditStamp(AuditStamp.uid(sessionManager)))
                // Not awaited, but a refusal (e.g. the office closed it first) must be seen.
                .addOnFailureListener {
                    val answer = if (note.isEmpty()) "\"Received\"" else "problem report \"$note\""
                    _receiptError.value = "Your $answer was not saved. The transfer may already " +
                        "be closed. Tell the office directly."
                }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ── Work Progress ──────────────────────────────────────────────────────

    override suspend fun submitWorkProgress(
        progress: WorkProgress,
        docId: String?,
        photoUrls: List<String>
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
            // Stampable: the submission CREATE rule is isOwner + createdUnreviewed() (which
            // only inspects `status`), no hasOnly — extra fields are accepted.
            ref.set(data.toMap().withAuditStamp(AuditStamp.uid(sessionManager)))
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * ⚠️ AUDIT-EXEMPT — no lastModifiedBy/lastModifiedAt.
     * On every submission collection (material_requests, material_purchases,
     * material_transfers, tool_transfers, work_progress) firestore.rules lets the OWNER update
     * only when changedKeysWithin(['photoUrls']) holds — hasOnly, so a second or third key makes
     * this PERMISSION_DENIED and the uploaded photos would never be linked to the document.
     * The create above (same doc, same actor, moments earlier) already carries the stamp.
     */
    override suspend fun updatePhotoUrls(
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

    override suspend fun getWorkProgress(): Result<List<WorkProgress>> {
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