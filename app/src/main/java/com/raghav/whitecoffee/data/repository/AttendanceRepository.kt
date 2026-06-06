package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceType
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
     * Fetches all attendance events for today, ordered by timestamp.
     * Derives the current AttendanceState from the event sequence.
     */
    suspend fun getTodayState(): Result<AttendanceState> {
        return try {
            val today = LocalDate.now().format(dateFormatter)
            val snapshot = collection
                .whereEqualTo("date", today)
                .get()
                .await()

            val events = snapshot.documents
                .mapNotNull { AttendanceRecord.fromDocument(it) }
                .sortedBy { it.timestamp?.seconds ?: 0L }
            val state = deriveState(events)
            Result.success(state)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Derives current attendance state from today's event list.
     * The last event determines the current state.
     */
    private fun deriveState(events: List<AttendanceRecord>): AttendanceState {
        if (events.isEmpty()) return AttendanceState.NoRecord
        return when (val lastEvent = events.last().type) {
            AttendanceType.HOME_IN    -> AttendanceState.HomeCheckedIn(events.last())
            AttendanceType.HOME_OUT   -> AttendanceState.DayComplete
            AttendanceType.SITE_IN    -> AttendanceState.SiteCheckedIn(events.last())
            AttendanceType.SITE_OUT   -> AttendanceState.HomeCheckedIn(events.last())
            AttendanceType.MARKET_IN  -> AttendanceState.MarketCheckedIn(events.last())
            AttendanceType.MARKET_OUT -> AttendanceState.HomeCheckedIn(events.last())
            else -> AttendanceState.NoRecord
        }
    }

    /**
     * Records a single attendance event.
     * Every check-in and check-out calls this — GPS always captured.
     */
    suspend fun recordEvent(
        type: String,
        latitude: Double,
        longitude: Double,
        siteId: String = "",
        siteName: String = "",
        marketName: String = "",
        locationName: String = ""  // office attendance: free-text location entered by user
    ): Result<String> {
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
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Fetches today's full event log — for displaying timeline on screen.
     */
    suspend fun getTodayEvents(): Result<List<AttendanceRecord>> {
        return try {
            val today = LocalDate.now().format(dateFormatter)
            val snapshot = collection
                .whereEqualTo("date", today)
                .get()
                .await()
            val events = snapshot.documents
                .mapNotNull { AttendanceRecord.fromDocument(it) }
                .sortedBy { it.timestamp?.seconds ?: 0L }
            Result.success(events)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}