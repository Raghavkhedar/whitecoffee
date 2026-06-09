package com.raghav.whitecoffee.data.model

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.DocumentSnapshot

data class RequestItem(
    val itemName: String = "",
    val quantity: Double = 0.0,
    val unit: String = "",      // e.g. "pcs", "kg", "m"
    val notes: String = ""
) {
    fun toMap(): Map<String, Any> = mapOf(
        "itemName" to itemName,
        "quantity" to quantity,
        "unit"     to unit,
        "notes"    to notes
    )

    companion object {
        fun fromMap(map: Map<*, *>): RequestItem = RequestItem(
            itemName = map["itemName"] as? String ?: "",
            quantity = (map["quantity"] as? Number)?.toDouble() ?: 0.0,
            unit     = map["unit"] as? String ?: "",
            notes    = map["notes"] as? String ?: ""
        )
    }
}

data class MaterialToolRequest(
    @DocumentId
    val id: String = "",
    val userId: String = "",
    val userName: String = "",
    val employeeId: String = "",
    val siteId: String = "",
    val siteName: String = "",
    val items: List<RequestItem> = emptyList(),
    val notes: String = "",
    val photoUrls: List<String> = emptyList(),
    val submittedAt: Timestamp? = null
) {
    /** One row per item for Google Sheets export */
    fun toSheetRows(): List<Map<String, Any>> = items.map { item ->
        mapOf(
            "Employee ID"  to employeeId,
            "Name"         to userName,
            "Site"         to siteName,
            "Item"         to item.itemName,
            "Quantity"     to item.quantity,
            "Unit"         to item.unit,
            "Item Notes"   to item.notes,
            "Notes"        to notes,
            "Submitted At" to (submittedAt?.toDate()?.toString() ?: "")
        )
    }

    fun toMap(): Map<String, Any?> = mapOf(
        "userId"      to userId,
        "userName"    to userName,
        "employeeId"  to employeeId,
        "siteId"      to siteId,
        "siteName"    to siteName,
        "items"       to items.map { it.toMap() },
        "notes"       to notes,
        "photoUrls"   to photoUrls,
        "submittedAt" to submittedAt
    )

    companion object {
        fun fromDocument(doc: DocumentSnapshot): MaterialToolRequest? {
            return try {
                val rawItems = (doc.get("items") as? List<*>)
                    ?.filterIsInstance<Map<*, *>>()
                    ?.map { RequestItem.fromMap(it) }
                    ?: emptyList()
                val photoUrls = (doc.get("photoUrls") as? List<*>)
                    ?.filterIsInstance<String>()
                    ?: emptyList()
                MaterialToolRequest(
                    id          = doc.id,
                    userId      = doc.getString("userId") ?: return null,
                    userName    = doc.getString("userName") ?: "",
                    employeeId  = doc.getString("employeeId") ?: "",
                    siteId      = doc.getString("siteId") ?: "",
                    siteName    = doc.getString("siteName") ?: "",
                    items       = rawItems,
                    notes       = doc.getString("notes") ?: "",
                    photoUrls   = photoUrls,
                    submittedAt = doc.getTimestamp("submittedAt")
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}