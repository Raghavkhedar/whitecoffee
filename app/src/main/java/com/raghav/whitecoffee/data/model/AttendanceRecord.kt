package com.raghav.whitecoffee.data.model

import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.DocumentSnapshot

data class AttendanceRecord(
    @DocumentId
    val id: String = "",
    val userId: String = "",
    val userName: String = "",
    val employeeId: String = "",
    val mode: String = "",          // "home", "site", "market"
    val date: String = "",          // yyyy-MM-dd
    val checkInTime: String = "",   // hh:mm a  (display only)
    val checkOutTime: String = "",  // hh:mm a  (display only, empty if not checked out)
    val checkInLat: Double = 0.0,
    val checkInLng: Double = 0.0,
    val siteId: String = "",        // populated when mode = "site"
    val siteName: String = "",      // populated when mode = "site"
    val marketName: String = "",    // populated when mode = "market"
    val timestamp: Timestamp? = null
) {
    /** For Google Sheets export — flat map, every field a primitive */
    fun toSheetRow(): Map<String, Any> = mapOf(
        "Employee ID"    to employeeId,
        "Name"           to userName,
        "Date"           to date,
        "Mode"           to mode,
        "Site/Market"    to if (mode == "site") siteName else marketName,
        "Check In"       to checkInTime,
        "Check Out"      to checkOutTime,
        "Latitude"       to checkInLat,
        "Longitude"      to checkInLng
    )

    /** For Firestore writes */
    fun toMap(): Map<String, Any?> = mapOf(
        "userId"       to userId,
        "userName"     to userName,
        "employeeId"   to employeeId,
        "mode"         to mode,
        "date"         to date,
        "checkInTime"  to checkInTime,
        "checkOutTime" to checkOutTime,
        "checkInLat"   to checkInLat,
        "checkInLng"   to checkInLng,
        "siteId"       to siteId,
        "siteName"     to siteName,
        "marketName"   to marketName,
        "timestamp"    to timestamp
    )

    companion object {
        fun fromDocument(doc: DocumentSnapshot): AttendanceRecord? {
            return try {
                AttendanceRecord(
                    id            = doc.id,
                    userId        = doc.getString("userId") ?: return null,
                    userName      = doc.getString("userName") ?: "",
                    employeeId    = doc.getString("employeeId") ?: "",
                    mode          = doc.getString("mode") ?: return null,
                    date          = doc.getString("date") ?: return null,
                    checkInTime   = doc.getString("checkInTime") ?: "",
                    checkOutTime  = doc.getString("checkOutTime") ?: "",
                    checkInLat    = doc.getDouble("checkInLat") ?: 0.0,
                    checkInLng    = doc.getDouble("checkInLng") ?: 0.0,
                    siteId        = doc.getString("siteId") ?: "",
                    siteName      = doc.getString("siteName") ?: "",
                    marketName    = doc.getString("marketName") ?: "",
                    timestamp     = doc.getTimestamp("timestamp")
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}