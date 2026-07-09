package com.raghav.whitecoffee.data.model

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.DocumentSnapshot

/**
 * Attendance event types — every check-in and check-out
 * is a separate document in the attendance collection.
 */
object AttendanceType {
    const val HOME_IN     = "home_in"
    const val HOME_OUT    = "home_out"
    const val SITE_IN     = "site_in"
    const val SITE_OUT    = "site_out"
    const val MARKET_IN   = "market_in"
    const val MARKET_OUT  = "market_out"
    // Office role — simple check-in/out only
    const val OFFICE_IN   = "office_in"
    const val OFFICE_OUT  = "office_out"
}

/**
 * Represents the current attendance state of the user for today.
 * Derived by reading all today's attendance events in order.
 */
sealed interface AttendanceState {
    data object NoRecord : AttendanceState
    data class HomeCheckedIn(val record: AttendanceRecord) : AttendanceState
    data class SiteCheckedIn(val record: AttendanceRecord) : AttendanceState
    data class MarketCheckedIn(val record: AttendanceRecord) : AttendanceState
    data object DayComplete : AttendanceState
}

data class AttendanceRecord(
    @DocumentId
    val id: String = "",
    val userId: String = "",
    val employeeId: String = "",
    val userName: String = "",
    val date: String = "",
    val type: String = "",          // AttendanceType constant
    val timestamp: Timestamp? = null,
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val siteId: String = "",
    val siteName: String = "",
    val marketName: String = "",
    val locationName: String = ""  // office check-in/out: free-text location entered by user
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "userId"       to userId,
        "employeeId"   to employeeId,
        "userName"     to userName,
        "date"         to date,
        "type"         to type,
        "timestamp"    to timestamp,
        "latitude"     to latitude,
        "longitude"    to longitude,
        "siteId"       to siteId,
        "siteName"     to siteName,
        "marketName"   to marketName,
        "locationName" to locationName
    )

    /** Display time — hh:mm a format from Firestore Timestamp */
    fun displayTime(): String {
        val ts = timestamp ?: return ""
        val sdf = java.text.SimpleDateFormat("hh:mm a", java.util.Locale.getDefault())
        return sdf.format(ts.toDate())
    }

    companion object {
        fun fromDocument(doc: DocumentSnapshot): AttendanceRecord? {
            return try {
                AttendanceRecord(
                    id          = doc.id,
                    userId      = doc.getString("userId") ?: return null,
                    employeeId  = doc.getString("employeeId") ?: "",
                    userName    = doc.getString("userName") ?: "",
                    date        = doc.getString("date") ?: return null,
                    type        = doc.getString("type") ?: return null,
                    timestamp   = doc.getTimestamp("timestamp"),
                    latitude    = doc.getDouble("latitude") ?: 0.0,
                    longitude   = doc.getDouble("longitude") ?: 0.0,
                    siteId       = doc.getString("siteId") ?: "",
                    siteName     = doc.getString("siteName") ?: "",
                    marketName   = doc.getString("marketName") ?: "",
                    locationName = doc.getString("locationName") ?: ""
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}

/** Derives the current AttendanceState from an ordered list of today's events. */
fun deriveAttendanceState(events: List<AttendanceRecord>): AttendanceState {
    if (events.isEmpty()) return AttendanceState.NoRecord
    return when (events.last().type) {
        AttendanceType.HOME_IN    -> AttendanceState.HomeCheckedIn(events.last())
        AttendanceType.HOME_OUT   -> AttendanceState.DayComplete
        AttendanceType.SITE_IN    -> AttendanceState.SiteCheckedIn(events.last())
        AttendanceType.SITE_OUT   -> AttendanceState.HomeCheckedIn(events.last())
        AttendanceType.MARKET_IN  -> AttendanceState.MarketCheckedIn(events.last())
        AttendanceType.MARKET_OUT -> AttendanceState.HomeCheckedIn(events.last())
        else                      -> AttendanceState.NoRecord
    }
}