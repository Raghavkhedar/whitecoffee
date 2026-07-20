package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.raghav.whitecoffee.data.firestore.AuditStamp
import com.raghav.whitecoffee.data.firestore.snapshotsAsFlow
import com.raghav.whitecoffee.data.firestore.withAuditStamp
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.AttendanceStatusRules
import com.raghav.whitecoffee.data.model.AttendanceType
import com.raghav.whitecoffee.data.model.deriveAttendanceState
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AttendanceRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager,
    // Only for reading the mock-location status of the fix behind this punch, so the
    // server can flag it. Injecting the provider avoids threading the flag through all
    // ten recordEvent call sites.
    private val locationProvider: LocationProvider
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

    /** Live version of getTodayData(): re-emits whenever today's attendance docs change. */
    fun observeTodayData(): Flow<Pair<AttendanceState, List<AttendanceRecord>>> {
        val today = LocalDate.now().format(dateFormatter)
        return collection.whereEqualTo("date", today).snapshotsAsFlow().map { snapshot ->
            val events = snapshot.documents
                .mapNotNull { AttendanceRecord.fromDocument(it) }
                .sortedBy { it.timestamp?.toDate()?.time ?: 0L }
            Pair(deriveAttendanceState(events), events)
        }
    }

    /**
     * Today's admin-set planned shift window for this (operations) user, read from
     * users/{uid}/planned_hours/{today}. Returns:
     *  - success(null)          → no plan set (payroll leaves the day unmarked),
     *  - success((start,end))   → resolved minutes-of-day window (10:00–18:00 fallback for an
     *                             inverted/zero shift), mirroring computeDailyAttendanceStatus.
     * Office/admin don't use this — their window is a fixed 10:00–18:00.
     */
    suspend fun getTodayPlannedWindow(): Result<Pair<Int, Int>?> {
        return try {
            val today = LocalDate.now().format(dateFormatter)
            val doc = userDoc.collection("planned_hours").document(today).get().await()
            val window = AttendanceStatusRules.resolveOpsWindow(
                doc.getString("startTime"),
                doc.getString("endTime"),
            )
            Result.success(window)
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
                locationName = locationName,
                isMockLocation = locationProvider.lastFixWasMock
            )
            // Deliberately NOT awaited: the Firestore SDK persists this locally and syncs
            // when connectivity returns, which is what makes check-in work offline at a
            // site with no signal. Awaiting here would hang the punch until the network
            // came back. The server-side onPunchWritten trigger scores it on arrival.
            //
            // Audit stamp is safe here: the punch create rule (isValidPunch) validates the
            // type / timestamp window / date / coords but does NOT use hasOnly, so extra
            // fields are accepted. No existing field is touched.
            ref.set(record.toMap().withAuditStamp(AuditStamp.uid(sessionManager)))
            Result.success(record)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
