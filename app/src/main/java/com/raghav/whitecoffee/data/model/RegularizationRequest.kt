package com.raghav.whitecoffee.data.model

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.DocumentSnapshot

data class RegularizationRequest(
    @DocumentId
    val id: String = "",
    val userId: String = "",
    val userName: String = "",
    val employeeId: String = "",
    val date: String = "",
    val originalStatus: String = "",
    val reason: String = "",
    val status: String = "pending",
    val approvedBy: String = "",
    val approverComment: String = "",
    val submittedAt: Timestamp? = null,
    val reviewedAt: Timestamp? = null
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "userId"          to userId,
        "userName"        to userName,
        "employeeId"      to employeeId,
        "date"            to date,
        "originalStatus"  to originalStatus,
        "reason"          to reason,
        "status"          to status,
        "approvedBy"      to approvedBy,
        "approverComment" to approverComment,
        "submittedAt"     to submittedAt,
        "reviewedAt"      to reviewedAt
    )

    companion object {
        fun fromDocument(doc: DocumentSnapshot): RegularizationRequest? {
            return try {
                RegularizationRequest(
                    id              = doc.id,
                    userId          = doc.getString("userId") ?: return null,
                    userName        = doc.getString("userName") ?: "",
                    employeeId      = doc.getString("employeeId") ?: "",
                    date            = doc.getString("date") ?: "",
                    originalStatus  = doc.getString("originalStatus") ?: "",
                    reason          = doc.getString("reason") ?: "",
                    status          = doc.getString("status") ?: "pending",
                    approvedBy      = doc.getString("approvedBy") ?: "",
                    approverComment = doc.getString("approverComment") ?: "",
                    submittedAt     = doc.getTimestamp("submittedAt"),
                    reviewedAt      = doc.getTimestamp("reviewedAt")
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}
