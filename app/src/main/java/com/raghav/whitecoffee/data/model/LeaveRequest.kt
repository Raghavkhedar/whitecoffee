package com.raghav.whitecoffee.data.model

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.DocumentSnapshot

data class LeaveRequest(
    @DocumentId
    val id: String = "",
    val userId: String = "",          // kept for collectionGroup path resolution
    val userName: String = "",
    val employeeId: String = "",
    val leaveType: String = "",       // legacy / empty for new submissions
    val fromDate: String = "",        // yyyy-MM-dd
    val toDate: String = "",          // yyyy-MM-dd
    val totalDays: Int = 0,
    val joiningDate: String = "",     // yyyy-MM-dd
    val emergencyContact: String = "",
    val placeOfVisit: String = "",
    val reason: String = "",
    val status: String = "pending",   // pending / approved / rejected
    val approvedBy: String = "",
    val approverComment: String = "",
    val submittedAt: Timestamp? = null,
    val reviewedAt: Timestamp? = null
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "userId"           to userId,
        "userName"         to userName,
        "employeeId"       to employeeId,
        "leaveType"        to leaveType,
        "fromDate"         to fromDate,
        "toDate"           to toDate,
        "totalDays"        to totalDays,
        "joiningDate"      to joiningDate,
        "emergencyContact" to emergencyContact,
        "placeOfVisit"     to placeOfVisit,
        "reason"           to reason,
        "status"           to status,
        "approvedBy"       to approvedBy,
        "approverComment"  to approverComment,
        "submittedAt"      to submittedAt,
        "reviewedAt"       to reviewedAt
    )

    companion object {
        fun fromDocument(doc: DocumentSnapshot): LeaveRequest? {
            return try {
                LeaveRequest(
                    id               = doc.id,
                    userId           = doc.getString("userId") ?: return null,
                    userName         = doc.getString("userName") ?: "",
                    employeeId       = doc.getString("employeeId") ?: "",
                    leaveType        = doc.getString("leaveType") ?: "",
                    fromDate         = doc.getString("fromDate") ?: "",
                    toDate           = doc.getString("toDate") ?: "",
                    totalDays        = (doc.getLong("totalDays") ?: 0L).toInt(),
                    joiningDate      = doc.getString("joiningDate") ?: "",
                    emergencyContact = doc.getString("emergencyContact") ?: "",
                    placeOfVisit     = doc.getString("placeOfVisit") ?: "",
                    reason           = doc.getString("reason") ?: "",
                    status           = doc.getString("status") ?: "pending",
                    approvedBy       = doc.getString("approvedBy") ?: "",
                    approverComment  = doc.getString("approverComment") ?: "",
                    submittedAt      = doc.getTimestamp("submittedAt"),
                    reviewedAt       = doc.getTimestamp("reviewedAt")
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}

object LeaveType {
    const val SICK     = "Sick Leave"
    const val CASUAL   = "Casual Leave"
    const val ANNUAL   = "Annual Leave"
    const val UNPAID   = "Unpaid Leave"
    val ALL = listOf(SICK, CASUAL, ANNUAL, UNPAID)
}
