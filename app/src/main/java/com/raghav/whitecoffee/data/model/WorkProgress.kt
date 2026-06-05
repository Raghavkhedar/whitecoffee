package com.raghav.whitecoffee.data.model

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.DocumentSnapshot

data class WorkProgress(
    @DocumentId
    val id: String = "",
    val userId: String = "",
    val userName: String = "",
    val employeeId: String = "",
    val siteId: String = "",
    val siteName: String = "",
    val date: String = "",              // yyyy-MM-dd
    val hoursWorked: Double = 0.0,      // e.g. 7.5
    val workDescription: String = "",
    val photoUrls: List<String> = emptyList(),
    val submittedAt: Timestamp? = null
) {
    /** Flat row for Google Sheets export */
    fun toSheetRow(): Map<String, Any> = mapOf(
        "Employee ID"      to employeeId,
        "Name"             to userName,
        "Site"             to siteName,
        "Date"             to date,
        "Hours Worked"     to hoursWorked,
        "Work Description" to workDescription,
        "Photo Count"      to photoUrls.size,
        "Submitted At"     to (submittedAt?.toDate()?.toString() ?: "")
    )

    fun toMap(): Map<String, Any?> = mapOf(
        "userId"          to userId,
        "userName"        to userName,
        "employeeId"      to employeeId,
        "siteId"          to siteId,
        "siteName"        to siteName,
        "date"            to date,
        "hoursWorked"     to hoursWorked,
        "workDescription" to workDescription,
        "photoUrls"       to photoUrls,
        "submittedAt"     to submittedAt
    )

    companion object {
        fun fromDocument(doc: DocumentSnapshot): WorkProgress? {
            return try {
                WorkProgress(
                    id              = doc.id,
                    userId          = doc.getString("userId") ?: return null,
                    userName        = doc.getString("userName") ?: "",
                    employeeId      = doc.getString("employeeId") ?: "",
                    siteId          = doc.getString("siteId") ?: "",
                    siteName        = doc.getString("siteName") ?: "",
                    date            = doc.getString("date") ?: "",
                    hoursWorked     = doc.getDouble("hoursWorked") ?: 0.0,
                    workDescription = doc.getString("workDescription") ?: "",
                    photoUrls       = (doc.get("photoUrls") as? List<*>)
                        ?.filterIsInstance<String>() ?: emptyList(),
                    submittedAt     = doc.getTimestamp("submittedAt")
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}