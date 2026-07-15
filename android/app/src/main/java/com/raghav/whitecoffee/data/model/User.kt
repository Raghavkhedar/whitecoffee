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
    val createdAt: Timestamp? = null,
    val active: Boolean = true,
    val suspendedReason: String = "",
    val suspendedBy: String = "",
    val expectedReturn: String = ""
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
                    createdAt = doc.getTimestamp("createdAt"),
                    // Missing `active` (older docs) is treated as active, so nobody is
                    // wrongly locked out during rollout.
                    active = doc.getBoolean("active") ?: true,
                    suspendedReason = doc.getString("suspendedReason") ?: "",
                    suspendedBy = doc.getString("suspendedBy") ?: "",
                    expectedReturn = doc.getString("expectedReturn") ?: ""
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}