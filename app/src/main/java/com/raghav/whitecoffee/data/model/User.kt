package com.raghav.whitecoffee.data.model

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.DocumentSnapshot

data class User(
    @DocumentId
    val id: String = "",
    val name: String = "",
    val email: String = "",
    val role: String = "",
    val employeeId: String = "",
    val assignedSites: List<String> = emptyList(),
    val createdAt: Timestamp? = null
) {
    companion object {
        fun fromDocument(doc: DocumentSnapshot): User? {
            return try {
                User(
                    id = doc.id,
                    name = doc.getString("name")?.trim() ?: return null,
                    email = doc.getString("email")?.lowercase()?.trim() ?: return null,
                    role = doc.getString("role")?.trim() ?: return null,
                    employeeId = doc.getString("employeeId")?.trim() ?: "",
                    assignedSites = (doc.get("assignedSites") as? List<*>)
                        ?.filterIsInstance<String>() ?: emptyList(),
                    createdAt = doc.getTimestamp("createdAt")
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}