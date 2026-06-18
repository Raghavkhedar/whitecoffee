package com.raghav.whitecoffee.data.model

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentSnapshot

data class AttendanceStatusRecord(
    val id: String = "",
    val date: String = "",
    val userId: String = "",
    val userName: String = "",
    val employeeId: String = "",
    val role: String = "",
    val status: String = "",
    val markedBy: String = "",
    val updatedAt: Timestamp? = null
) {
    companion object {
        fun fromDocument(doc: DocumentSnapshot): AttendanceStatusRecord? {
            return try {
                AttendanceStatusRecord(
                    id         = doc.id,
                    date       = doc.getString("date") ?: return null,
                    userId     = doc.getString("userId") ?: "",
                    userName   = doc.getString("userName") ?: "",
                    employeeId = doc.getString("employeeId") ?: "",
                    role       = doc.getString("role") ?: "",
                    status     = doc.getString("status") ?: "",
                    markedBy   = doc.getString("markedBy") ?: "",
                    updatedAt  = doc.getTimestamp("updatedAt")
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}
