package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.raghav.whitecoffee.data.model.AttendanceRecord
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

    private val collection get() = firestore.collection("attendance")
    private val dateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")

    /**
     * Fetches today's attendance record for the current user.
     * Returns null inside Result.success if no record exists yet today.
     */
    suspend fun getTodayAttendance(): Result<AttendanceRecord?> {
        return try {
            val today = LocalDate.now().format(dateFormatter)
            val snapshot = collection
                .whereEqualTo("userId", sessionManager.userId)
                .whereEqualTo("date", today)
                .limit(1)
                .get()
                .await()

            val record = snapshot.documents.firstOrNull()?.let {
                AttendanceRecord.fromDocument(it)
            }
            Result.success(record)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Creates a new check-in record.
     * Called when user taps any check-in button (Home / Site / Market).
     */
    suspend fun checkIn(
        mode: String,
        checkInTime: String,
        latitude: Double,
        longitude: Double,
        siteId: String = "",
        siteName: String = "",
        marketName: String = ""
    ): Result<String> {
        return try {
            val today = LocalDate.now().format(dateFormatter)
            val record = AttendanceRecord(
                userId      = sessionManager.userId,
                userName    = sessionManager.name,
                employeeId  = sessionManager.employeeId,
                mode        = mode,
                date        = today,
                checkInTime = checkInTime,
                checkInLat  = latitude,
                checkInLng  = longitude,
                siteId      = siteId,
                siteName    = siteName,
                marketName  = marketName,
                timestamp   = Timestamp.now()
            )

            val docRef = collection.add(record.toMap()).await()
            Result.success(docRef.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Updates an existing attendance record with check-out time.
     * Called when user taps any check-out button.
     */
    suspend fun checkOut(
        recordId: String,
        checkOutTime: String
    ): Result<Unit> {
        return try {
            collection
                .document(recordId)
                .update("checkOutTime", checkOutTime)
                .await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Fetches attendance history for the current user.
     * Ordered by date descending — most recent first.
     */
    suspend fun getAttendanceHistory(limit: Long = 30): Result<List<AttendanceRecord>> {
        return try {
            val snapshot = collection
                .whereEqualTo("userId", sessionManager.userId)
                .orderBy("timestamp", com.google.firebase.firestore.Query.Direction.DESCENDING)
                .limit(limit)
                .get()
                .await()

            val records = snapshot.documents.mapNotNull { AttendanceRecord.fromDocument(it) }
            Result.success(records)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}