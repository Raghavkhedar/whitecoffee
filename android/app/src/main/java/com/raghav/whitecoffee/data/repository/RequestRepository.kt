package com.raghav.whitecoffee.data.repository

import com.raghav.whitecoffee.data.model.MaterialToolPurchase
import com.raghav.whitecoffee.data.model.MaterialToolRequest
import com.raghav.whitecoffee.data.model.Transfer
import com.raghav.whitecoffee.data.model.WorkProgress

/**
 * Field submissions: M&T requests and purchases, material and tool transfers, work progress.
 *
 * Every submit follows the same photo contract — reserve a document id with [newDocId], write
 * the document, upload photos under that id, then patch the URLs back via [updatePhotoUrls].
 *
 * Implemented by [FirestoreRequestRepository] in production, faked in tests.
 */
interface RequestRepository {

    /** Reserves a document id up front so photos can be uploaded under it before the write. */
    fun newDocId(collectionName: String): String

    suspend fun submitMaterialToolRequest(
        request: MaterialToolRequest,
        docId: String? = null,
        photoUrls: List<String> = emptyList()
    ): Result<String>

    suspend fun getMaterialToolRequests(): Result<List<MaterialToolRequest>>

    suspend fun submitMaterialToolPurchase(
        purchase: MaterialToolPurchase,
        docId: String? = null,
        photoUrls: List<String> = emptyList()
    ): Result<String>

    suspend fun getMaterialToolPurchases(): Result<List<MaterialToolPurchase>>

    suspend fun submitMaterialTransfer(
        transfer: Transfer,
        docId: String? = null,
        photoUrls: List<String> = emptyList()
    ): Result<String>

    suspend fun getMaterialTransfers(): Result<List<Transfer>>

    suspend fun submitToolTransfer(
        transfer: Transfer,
        docId: String? = null,
        photoUrls: List<String> = emptyList()
    ): Result<String>

    suspend fun getToolTransfers(): Result<List<Transfer>>

    suspend fun submitWorkProgress(
        progress: WorkProgress,
        docId: String? = null,
        photoUrls: List<String> = emptyList()
    ): Result<String>

    /** Patches uploaded photo URLs onto an already-written document. */
    suspend fun updatePhotoUrls(
        collectionName: String,
        docId: String,
        urls: List<String>
    ): Result<Unit>

    suspend fun getWorkProgress(): Result<List<WorkProgress>>
}
