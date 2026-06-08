package com.raghav.whitecoffee.data.model

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentSnapshot

data class AppNotification(
    val id: String = "",
    val title: String = "",
    val body: String = "",
    val type: String = "general",
    val isRead: Boolean = false,
    val createdAt: Timestamp? = null
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "title"     to title,
        "body"      to body,
        "type"      to type,
        "isRead"    to isRead,
        "createdAt" to createdAt
    )

    companion object {
        fun fromDocument(doc: DocumentSnapshot): AppNotification? {
            return try {
                AppNotification(
                    id        = doc.id,
                    title     = doc.getString("title") ?: return null,
                    body      = doc.getString("body") ?: "",
                    type      = doc.getString("type") ?: "general",
                    isRead    = doc.getBoolean("isRead") ?: false,
                    createdAt = doc.getTimestamp("createdAt")
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}
