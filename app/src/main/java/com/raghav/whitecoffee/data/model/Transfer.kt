package com.raghav.whitecoffee.data.model

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.DocumentSnapshot

data class TransferItem(
    val itemName: String = "",
    val quantity: Int = 0,
    val unit: String = "",
    val condition: String = ""      // e.g. "Good", "Damaged" — important for tools
) {
    fun toMap(): Map<String, Any> = mapOf(
        "itemName"  to itemName,
        "quantity"  to quantity,
        "unit"      to unit,
        "condition" to condition
    )

    companion object {
        fun fromMap(map: Map<*, *>): TransferItem = TransferItem(
            itemName  = map["itemName"] as? String ?: "",
            quantity  = (map["quantity"] as? Long)?.toInt() ?: 0,
            unit      = map["unit"] as? String ?: "",
            condition = map["condition"] as? String ?: ""
        )
    }
}

data class Transfer(
    @DocumentId
    val id: String = "",
    val userId: String = "",
    val userName: String = "",
    val employeeId: String = "",
    val fromLocation: String = "",      // site name, warehouse, office etc.
    val toLocation: String = "",
    val transferredBy: String = "",     // name of person handing over
    val receivedBy: String = "",        // name of person receiving
    val items: List<TransferItem> = emptyList(),
    val status: String = "pending",
    val notes: String = "",
    val photoUrls: List<String> = emptyList(),
    val transferDate: String = "",      // yyyy-MM-dd
    val submittedAt: Timestamp? = null
) {
    /** One row per item for Google Sheets export */
    fun toSheetRows(): List<Map<String, Any>> = items.map { item ->
        mapOf(
            "Employee ID"    to employeeId,
            "Submitted By"   to userName,
            "From"           to fromLocation,
            "To"             to toLocation,
            "Transferred By" to transferredBy,
            "Received By"    to receivedBy,
            "Item"           to item.itemName,
            "Quantity"       to item.quantity,
            "Unit"           to item.unit,
            "Condition"      to item.condition,
            "Transfer Date"  to transferDate,
            "Status"         to status,
            "Notes"          to notes,
            "Submitted At"   to (submittedAt?.toDate()?.toString() ?: "")
        )
    }

    fun toMap(): Map<String, Any?> = mapOf(
        "userId"        to userId,
        "userName"      to userName,
        "employeeId"    to employeeId,
        "fromLocation"  to fromLocation,
        "toLocation"    to toLocation,
        "transferredBy" to transferredBy,
        "receivedBy"    to receivedBy,
        "items"         to items.map { it.toMap() },
        "status"        to status,
        "notes"         to notes,
        "photoUrls"     to photoUrls,
        "transferDate"  to transferDate,
        "submittedAt"   to submittedAt
    )

    companion object {
        fun fromDocument(doc: DocumentSnapshot): Transfer? {
            return try {
                val rawItems = (doc.get("items") as? List<*>)
                    ?.filterIsInstance<Map<*, *>>()
                    ?.map { TransferItem.fromMap(it) }
                    ?: emptyList()
                val photoUrls = (doc.get("photoUrls") as? List<*>)
                    ?.filterIsInstance<String>()
                    ?: emptyList()
                Transfer(
                    id            = doc.id,
                    userId        = doc.getString("userId") ?: return null,
                    userName      = doc.getString("userName") ?: "",
                    employeeId    = doc.getString("employeeId") ?: "",
                    fromLocation  = doc.getString("fromLocation") ?: "",
                    toLocation    = doc.getString("toLocation") ?: "",
                    transferredBy = doc.getString("transferredBy") ?: "",
                    receivedBy    = doc.getString("receivedBy") ?: "",
                    items         = rawItems,
                    status        = doc.getString("status") ?: "pending",
                    notes         = doc.getString("notes") ?: "",
                    photoUrls     = photoUrls,
                    transferDate  = doc.getString("transferDate") ?: "",
                    submittedAt   = doc.getTimestamp("submittedAt")
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}