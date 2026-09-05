package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.raghav.whitecoffee.data.firestore.AuditStamp
import com.raghav.whitecoffee.data.firestore.snapshotsAsFlow
import com.raghav.whitecoffee.data.firestore.withAuditStamp
import com.raghav.whitecoffee.data.model.RegularizationRequest
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FirestoreRegularizationRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) : RegularizationRepository {
    private val userDoc get() = firestore.collection("users").document(sessionManager.userId)
    private val regCol  get() = userDoc.collection("regularization_requests")
    private val statusCol get() = userDoc.collection("attendance_status")

    override fun observeRequestForDate(date: String): Flow<RegularizationRequest?> =
        regCol.whereEqualTo("date", date)
            .snapshotsAsFlow()
            .map { snap ->
                snap.documents.mapNotNull { RegularizationRequest.fromDocument(it) }.firstOrNull()
            }

    override fun observeWindowOpen(): Flow<Boolean> =
        firestore.collection("config").document("regularizationWindow")
            .snapshotsAsFlow()
            .map { it.getBoolean("open") ?: false }

    override suspend fun getStatusForDate(date: String): String? =
        statusCol.document(date).get().await().getString("status")

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
            val ref = regCol.document()
            val payload = request.toMap().withAuditStamp(AuditStamp.uid(sessionManager))

            // Today is unconditionally creatable by the rules (see firestore.rules) — this
            // write can never be denied, so it keeps the original offline-first behaviour:
            // document() mints the id locally and set() is durable on disk the moment it
            // returns. Awaiting it would hang the spinner indefinitely while offline (the
            // Task only resolves on server acknowledgement), which is the exact bug this
            // repository used to have before it was fixed — see the "Offline is the default"
            // section of android/CLAUDE.md.
            //
            // The duplicate check above reads through Firestore's cache, so offline it can
            // only see requests this device already knows about. The server-side rules and the
            // admin review remain the real guard against a double submission.
            //
            // A PAST date is different: it is now genuinely rejectable (window closed, that
            // month already Settle & Locked, or a clock-skew edge case) — the same reason
            // approveLeave/rejectLeave already await their write ("the one path the rules can
            // refuse, and a permission-denied only surfaces from the server"). So for a past
            // date we await and turn a denial into a real failure instead of reporting false
            // success for a request that silently never lands.
            if (date == LocalDate.now().toString()) {
                ref.set(payload)
                Result.success(ref.id)
            } else {
                ref.set(payload).await() // offline-write-policy-exempt: rules-refusable past date
                Result.success(ref.id)
            }
        } catch (e: Exception) {
            val message = if (e is FirebaseFirestoreException &&
                e.code == FirebaseFirestoreException.Code.PERMISSION_DENIED
            ) {
                "Regularization for past dates is currently closed, or that month has already been settled."
            } else {
                e.message ?: "Something went wrong."
            }
            Result.failure(Exception(message))
        }
    }
}
