package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.deriveAttendanceState
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.tasks.await
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AttendanceRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) {

    private val userDoc    get() = firestore.collection("users").document(sessionManager.userId)
    private val collection get() = userDoc.collection("attendance")
    private val dateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")

    /**
     * Single query for today's events — returns both the derived state and the full event list.
     * Replaces the previous getTodayState() + getTodayEvents() dual-query pattern.
     */
    suspend fun getTodayData(): Result<Pair<AttendanceState, List<AttendanceRecord>>> {
        return try {
            val today = LocalDate.now().format(dateFormatter)
            val snapshot = collection
                .whereEqualTo("date", today)
                .get()
                .await()
            val events = snapshot.documents
                .mapNotNull { AttendanceRecord.fromDocument(it) }
                .sortedBy { it.timestamp?.seconds ?: 0L }
            Result.success(Pair(deriveAttendanceState(events), events))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Records a single attendance event. Returns the full record with the generated Firestore
     * document ID so callers can do optimistic state updates without a re-fetch.
     */
    suspend fun recordEvent(
        type: String,
        latitude: Double,
        longitude: Double,
        siteId: String = "",
        siteName: String = "",
        marketName: String = "",
        locationName: String = ""
    ): Result<AttendanceRecord> {
        return try {
            val today = LocalDate.now().format(dateFormatter)
            val record = AttendanceRecord(
                userId       = sessionManager.userId,
                employeeId   = sessionManager.employeeId,
                userName     = sessionManager.name,
                date         = today,
                type         = type,
                timestamp    = Timestamp.now(),
                latitude     = latitude,
                longitude    = longitude,
                siteId       = siteId,
                siteName     = siteName,
                marketName   = marketName,
                locationName = locationName
            )
            val ref = collection.add(record.toMap()).await()
            Result.success(record.copy(id = ref.id))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
