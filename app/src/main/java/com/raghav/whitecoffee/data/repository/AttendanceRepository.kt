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
                .sortedBy { it.timestamp?.toDate()?.time ?: 0L }
            Result.success(Pair(deriveAttendanceState(events), events))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Records a single attendance event. Returns the full record with the generated Firestore
     * document ID so callers can do optimistic state updates without a re-fetch.
     *
     * Offline-first: the document reference is created locally and written with set(). Firestore
     * persists the write to its on-disk cache synchronously and flushes it to the server
     * automatically on reconnect. We deliberately do NOT await the server round-trip — with
     * offline persistence enabled (see WhiteCoffeeApp), add()/set().await() never completes while
     * offline and would hang the check-in spinner indefinitely (stress test #1.1). The write is
     * durable the moment this returns, so it survives an immediate app kill (stress test #2.3),
     * and the offline banner signals to the user that the sync is still pending.
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
            val ref = collection.document()
            val record = AttendanceRecord(
                id           = ref.id,
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
            ref.set(record.toMap())
            Result.success(record)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
