package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.raghav.whitecoffee.data.model.RegularizationRequest
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class RegularizationRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) {
    private val userDoc get() = firestore.collection("users").document(sessionManager.userId)
    private val regCol  get() = userDoc.collection("regularization_requests")

    suspend fun getRequestForDate(date: String): Result<RegularizationRequest?> {
        return try {
            val snapshot = regCol
                .whereEqualTo("date", date)
                .get()
                .await()
            val request = snapshot.documents
                .mapNotNull { RegularizationRequest.fromDocument(it) }
                .firstOrNull()
            Result.success(request)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun submitRequest(
        date: String,
        originalStatus: String,
        reason: String
    ): Result<String> {
        return try {
            if (reason.isBlank()) {
                return Result.failure(Exception("Please enter a reason."))
            }
            val existing = regCol
                .whereEqualTo("date", date)
                .get()
                .await()
            val hasActiveRequest = existing.documents
                .mapNotNull { RegularizationRequest.fromDocument(it) }
                .any { it.status == "pending" || it.status == "approved" }
            if (hasActiveRequest) {
                return Result.failure(Exception("A request already exists for this date."))
            }

            val request = RegularizationRequest(
                userId         = sessionManager.userId,
                userName       = sessionManager.name,
                employeeId     = sessionManager.employeeId,
                date           = date,
                originalStatus = originalStatus,
                reason         = reason,
                submittedAt    = Timestamp.now()
            )
            val ref = regCol.add(request.toMap()).await()
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
