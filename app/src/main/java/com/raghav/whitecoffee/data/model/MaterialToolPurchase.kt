package com.raghav.whitecoffee.data.model

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.DocumentSnapshot

data class PurchaseItem(
    val itemName: String = "",
    val quantity: Double = 0.0,
    val unit: String = "",
    val pricePerUnit: Double = 0.0,
    val totalPrice: Double = 0.0,
    val spec1: String = "",
    val spec2: String = "",
    val notes: String = ""
) {
    fun toMap(): Map<String, Any> = mapOf(
        "itemName"     to itemName,
        "quantity"     to quantity,
        "unit"         to unit,
        "pricePerUnit" to pricePerUnit,
        "totalPrice"   to totalPrice,
        "spec1"        to spec1,
        "spec2"        to spec2,
        "notes"        to notes
    )

    companion object {
        fun fromMap(map: Map<*, *>): PurchaseItem = PurchaseItem(
            itemName     = map["itemName"] as? String ?: "",
            quantity     = (map["quantity"] as? Number)?.toDouble() ?: 0.0,
            unit         = map["unit"] as? String ?: "",
            pricePerUnit = map["pricePerUnit"] as? Double ?: 0.0,
            totalPrice   = map["totalPrice"] as? Double ?: 0.0,
            spec1        = map["spec1"] as? String ?: "",
            spec2        = map["spec2"] as? String ?: "",
            notes        = map["notes"] as? String ?: ""
        )
    }
}

data class MaterialToolPurchase(
    @DocumentId
    val id: String = "",
    val userId: String = "",
    val userName: String = "",
    val employeeId: String = "",
    val siteId: String = "",
    val siteName: String = "",
    val items: List<PurchaseItem> = emptyList(),
    val grandTotal: Double = 0.0,
    val notes: String = "",
    val photoUrls: List<String> = emptyList(),
    val submittedAt: Timestamp? = null
) {
    /** One row per item for Google Sheets export */
    fun toSheetRows(): List<Map<String, Any>> = items.map { item ->
        mapOf(
            "Employee ID"    to employeeId,
            "Name"           to userName,
            "Site"           to siteName,
            "Item"           to item.itemName,
            "Quantity"       to item.quantity,
            "Unit"           to item.unit,
            "Price Per Unit" to item.pricePerUnit,
            "Total Price"    to item.totalPrice,
            "Grand Total"    to grandTotal,
            "Spec 1"         to item.spec1,
            "Spec 2"         to item.spec2,
            "Item Notes"     to item.notes,
            "Notes"          to notes,
            "Submitted At"   to (submittedAt?.toDate()?.toString() ?: "")
        )
    }

    fun toMap(): Map<String, Any?> = mapOf(
        "userId"      to userId,
        "userName"    to userName,
        "employeeId"  to employeeId,
        "siteId"      to siteId,
        "siteName"    to siteName,
        "items"       to items.map { it.toMap() },
        "grandTotal"  to grandTotal,
        "notes"       to notes,
        "photoUrls"   to photoUrls,
        "submittedAt" to submittedAt
    )

    companion object {
        fun fromDocument(doc: DocumentSnapshot): MaterialToolPurchase? {
            return try {
                val rawItems = (doc.get("items") as? List<*>)
                    ?.filterIsInstance<Map<*, *>>()
                    ?.map { PurchaseItem.fromMap(it) }
                    ?: emptyList()
                val photoUrls = (doc.get("photoUrls") as? List<*>)
                    ?.filterIsInstance<String>()
                    ?: emptyList()
                MaterialToolPurchase(
                    id          = doc.id,
                    userId      = doc.getString("userId") ?: return null,
                    userName    = doc.getString("userName") ?: "",
                    employeeId  = doc.getString("employeeId") ?: "",
                    siteId      = doc.getString("siteId") ?: "",
                    siteName    = doc.getString("siteName") ?: "",
                    items       = rawItems,
                    grandTotal  = doc.getDouble("grandTotal") ?: 0.0,
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