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
    /**
     * Sorted "yyyy-MM-dd" dates the approver actually granted. **Empty means "the whole
     * fromDate…toDate range"** — every legacy document lacks the field, and the Android
     * approve action never writes it, so both correctly mean a full grant. Derived state
     * only: see [approvalCoverage]. Never a status value — `status` stays approved/rejected.
     */
    val approvedDates: List<String> = emptyList(),
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
        "approvedDates"    to approvedDates,
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
                    // Absent on every legacy doc, and may be any type if hand-edited —
                    // never throw, just drop what isn't a usable date string.
                    approvedDates    = (doc.get("approvedDates") as? List<*>)
                        ?.mapNotNull { (it as? String)?.trim()?.takeIf(String::isNotEmpty) }
                        ?: emptyList(),
                    submittedAt      = doc.getTimestamp("submittedAt"),
                    reviewedAt       = doc.getTimestamp("reviewedAt")
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}

/**
 * What a leave request actually grants, derived — never stored. Mirrors the backend's
 * `leaveCoversDate` (firebase/functions/leaveCoverage.js) so the app and payroll agree on
 * which days are leave.
 */
data class LeaveCoverage(
    /** Inclusive days spanned by fromDate…toDate — what the employee asked for. */
    val requestedDays: Int,
    /** Days actually granted. Zero unless the request is approved. */
    val grantedDays: Int,
    /** The granted dates, sorted "yyyy-MM-dd". Full range when nothing narrower was set. */
    val grantedDates: List<String>,
    /** Approved, but for fewer days than were requested. */
    val isPartial: Boolean,
)

/**
 * Derives [LeaveCoverage] for this request.
 *
 * The compatibility rule: on an **approved** leave a missing or empty [approvedDates] grants
 * the entire fromDate…toDate range. That is what every pre-existing document means, and what
 * the Android approve action (which writes no `approvedDates`) means.
 *
 * Dates outside fromDate…toDate are ignored — the requested range still bounds the grant,
 * exactly as the backend predicate does.
 */
fun LeaveRequest.approvalCoverage(): LeaveCoverage {
    val range = datesInRange(fromDate, toDate)
    val requestedDays = if (range.isNotEmpty()) range.size else totalDays.coerceAtLeast(0)

    if (!status.equals("approved", ignoreCase = true)) {
        return LeaveCoverage(requestedDays, grantedDays = 0, grantedDates = emptyList(), isPartial = false)
    }

    val picked = approvedDates.map { it.trim() }.filter { it.isNotEmpty() }.distinct().sorted()
    if (picked.isEmpty()) {
        // Compatibility rule — the whole range was granted.
        return LeaveCoverage(requestedDays, requestedDays, range, isPartial = false)
    }

    val granted = if (range.isEmpty()) picked else picked.filter { it in range }
    return LeaveCoverage(
        requestedDays = requestedDays,
        grantedDays   = granted.size,
        grantedDates  = granted,
        isPartial     = requestedDays > 0 && granted.size < requestedDays,
    )
}

/** Inclusive "yyyy-MM-dd" days from [from] to [to]. Empty when either date is unusable. */
private fun datesInRange(from: String, to: String): List<String> {
    val start = parseIsoDate(from) ?: return emptyList()
    val end   = parseIsoDate(to) ?: return emptyList()
    if (end.isBefore(start)) return emptyList()
    val out = ArrayList<String>()
    var d = start
    while (!d.isAfter(end)) {
        out += d.toString()
        d = d.plusDays(1)
    }
    return out
}

private fun parseIsoDate(value: String): java.time.LocalDate? = try {
    java.time.LocalDate.parse(value.trim())
} catch (e: Exception) {
    null
}

/**
 * "21, 22, 24 Jul" — granted dates for display, month named once per run.
 * Returns "" for an empty list.
 */
fun formatGrantedDates(dates: List<String>): String {
    val parsed = dates.mapNotNull { raw -> parseIsoDate(raw)?.let { it } }
    if (parsed.isEmpty()) return ""
    val months = java.time.format.DateTimeFormatter.ofPattern("MMM", java.util.Locale.ENGLISH)
    return parsed.sorted()
        .groupBy { it.year to it.monthValue }
        .entries
        .joinToString(" · ") { (_, days) ->
            days.joinToString(", ") { it.dayOfMonth.toString() } + " " + days.first().format(months)
        }
}

object LeaveType {
    const val SICK     = "Sick Leave"
    const val CASUAL   = "Casual Leave"
    const val ANNUAL   = "Annual Leave"
    const val UNPAID   = "Unpaid Leave"
    val ALL = listOf(SICK, CASUAL, ANNUAL, UNPAID)
}
