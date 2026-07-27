package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.raghav.whitecoffee.data.firestore.AuditStamp
import com.raghav.whitecoffee.data.firestore.snapshotsAsFlow
import com.raghav.whitecoffee.data.firestore.withAuditStamp
import com.raghav.whitecoffee.data.model.RegularizationRequest
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FirestoreRegularizationRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) : RegularizationRepository {
    private val userDoc get() = firestore.collection("users").document(sessionManager.userId)
    private val regCol  get() = userDoc.collection("regularization_requests")

    override fun observeRequestForDate(date: String): Flow<RegularizationRequest?> =
        regCol.whereEqualTo("date", date)
            .snapshotsAsFlow()
            .map { snap ->
                snap.documents.mapNotNull { RegularizationRequest.fromDocument(it) }.firstOrNull()
            }

    override suspend fun submitRequest(
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
            // Offline-first, like recordEvent: document() mints the id locally and set() is
            // durable on disk the moment it returns. add().await() never completes while
            // offline (that Task resolves on server acknowledgement), which hung the submit
            // spinner and invited the user to retry into a duplicate.
            //
            // The duplicate check above reads through Firestore's cache, so offline it can
            // only see requests this device already knows about. The server-side rules and the
            // admin review remain the real guard against a double submission.
            //
            // Stampable: the regularization create rule only asserts status=='pending'
            // (no hasOnly), so the audit keys are accepted.
            val ref = regCol.document()
            ref.set(request.toMap().withAuditStamp(AuditStamp.uid(sessionManager)))
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
