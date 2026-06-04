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
    val marketName: String = ""
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "userId"      to userId,
        "employeeId"  to employeeId,
        "userName"    to userName,
        "date"        to date,
        "type"        to type,
        "timestamp"   to timestamp,
        "latitude"    to latitude,
        "longitude"   to longitude,
        "siteId"      to siteId,
        "siteName"    to siteName,
        "marketName"  to marketName
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
                    siteId      = doc.getString("siteId") ?: "",
                    siteName    = doc.getString("siteName") ?: "",
                    marketName  = doc.getString("marketName") ?: ""
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}