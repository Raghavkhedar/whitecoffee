package com.raghav.whitecoffee.fake

import com.raghav.whitecoffee.data.model.Employee
import com.raghav.whitecoffee.data.model.IncomingTransfer
import com.raghav.whitecoffee.data.model.MaterialToolPurchase
import com.raghav.whitecoffee.data.model.MaterialToolRequest
import com.raghav.whitecoffee.data.model.Transfer
import com.raghav.whitecoffee.data.model.WorkProgress
import com.raghav.whitecoffee.data.repository.RequestRepository
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * In-memory [RequestRepository] for unit tests.
 *
 * Ids are sequential and deterministic so a test can assert that the id reserved when photos
 * were picked is the same one the document is written under — the property that keeps cached
 * files and their owning document together.
 */
class FakeRequestRepository : RequestRepository {

    /** Every document written, as (collection, docId, payload). */
    val written = mutableListOf<Triple<String, String, Any>>()

    /** Ids handed out by [newDocId], in order. */
    val issuedIds = mutableListOf<String>()

    /** When set, every submit fails with this error. */
    var failWith: Exception? = null

    private var nextId = 1

    var directory: List<Employee> = emptyList()
    val incoming = MutableStateFlow<Result<List<IncomingTransfer>>>(Result.success(emptyList()))

    /** Every receipt written, as [collection, senderId, docId, status, note]. */
    val receipts = mutableListOf<List<String>>()

    var directoryLoads = 0
    override suspend fun getDirectory(): Result<List<Employee>> {
        directoryLoads++
        return Result.success(directory)
    }

    override val receiptError = MutableStateFlow<String?>(null)
    override fun clearReceiptError() { receiptError.value = null }

    override fun observeIncomingTransfers() = incoming

    override suspend fun confirmReceipt(
        collectionName: String, senderId: String, docId: String, status: String, note: String,
    ): Result<Unit> {
        receipts += listOf(collectionName, senderId, docId, status, note)
        return Result.success(Unit)
    }

    override fun newDocId(collectionName: String): String =
        "doc-${nextId++}".also { issuedIds += it }

    private fun record(collection: String, docId: String?, payload: Any): Result<String> {
        failWith?.let { return Result.failure(it) }
        val id = docId ?: newDocId(collection)
        written += Triple(collection, id, payload)
        return Result.success(id)
    }

    override suspend fun submitMaterialToolRequest(
        request: MaterialToolRequest,
        docId: String?,
        photoUrls: List<String>
    ): Result<String> = record("material_requests", docId, request)

    override suspend fun submitMaterialToolPurchase(
        purchase: MaterialToolPurchase,
        docId: String?,
        photoUrls: List<String>
    ): Result<String> = record("material_purchases", docId, purchase)

    override suspend fun submitMaterialTransfer(
        transfer: Transfer,
        docId: String?,
        photoUrls: List<String>
    ): Result<String> = record("material_transfers", docId, transfer)

    override suspend fun submitToolTransfer(
        transfer: Transfer,
        docId: String?,
        photoUrls: List<String>
    ): Result<String> = record("tool_transfers", docId, transfer)

    override suspend fun submitWorkProgress(
        progress: WorkProgress,
        docId: String?,
        photoUrls: List<String>
    ): Result<String> = record("work_progress", docId, progress)

    override suspend fun updatePhotoUrls(
        collectionName: String,
        docId: String,
        urls: List<String>
    ): Result<Unit> = Result.success(Unit)

    override suspend fun getMaterialToolRequests(): Result<List<MaterialToolRequest>> =
        Result.success(emptyList())

    override suspend fun getMaterialToolPurchases(): Result<List<MaterialToolPurchase>> =
        Result.success(emptyList())

    override suspend fun getMaterialTransfers(): Result<List<Transfer>> =
        Result.success(emptyList())

    override suspend fun getToolTransfers(): Result<List<Transfer>> =
        Result.success(emptyList())

    override suspend fun getWorkProgress(): Result<List<WorkProgress>> =
        Result.success(emptyList())
}
