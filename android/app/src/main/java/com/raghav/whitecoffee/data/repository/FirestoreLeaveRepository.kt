package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.raghav.whitecoffee.data.firestore.AuditStamp
import com.raghav.whitecoffee.data.firestore.snapshotsAsFlow
import com.raghav.whitecoffee.data.firestore.withAuditStamp
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FirestoreLeaveRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) : LeaveRepository {
    private val userDoc  get() = firestore.collection("users").document(sessionManager.userId)
    private val leaveCol get() = userDoc.collection("leave_requests")

    override suspend fun submitLeaveRequest(request: LeaveRequest): Result<String> {
        return try {
            if (request.reason.isBlank()) {
                return Result.failure(Exception("Please enter a reason for leave."))
            }
            val data = request.copy(
                userId      = sessionManager.userId,
                userName    = sessionManager.name,
                employeeId  = sessionManager.employeeId,
                submittedAt = Timestamp.now()
            )
            // Offline-first, like recordEvent: document() mints the id locally and set() is
            // durable on disk the moment it returns, so this reports success without a server
            // round-trip. The previous add().await() never completed while offline — Firestore
            // resolves that Task on server acknowledgement — so the submit spinner hung, the
            // user assumed failure, and every retry queued ANOTHER leave request for the
            // approver. Note this makes the call return promptly; it does not make retries
            // idempotent (each document() mints a fresh id). Removing the hang is what stops
            // the duplicates, by not misleading the user into retrying.
            //
            // Stampable: the leave-create rule checks status=='pending' + isValidLeaveDates,
            // neither of which uses hasOnly, so the extra audit keys are accepted.
            val ref = leaveCol.document()
            ref.set(data.toMap().withAuditStamp(AuditStamp.uid(sessionManager)))
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override fun observeMyLeaveRequests(): Flow<List<LeaveRequest>> =
        leaveCol.orderBy("submittedAt", Query.Direction.DESCENDING)
            .snapshotsAsFlow()
            .map { snap -> snap.documents.mapNotNull { LeaveRequest.fromDocument(it) } }

    // Office/admin only — collectionGroup across all users.
    // Requires Firestore index: leave_requests / status ASC + submittedAt ASC
    override fun observePendingLeaveRequests(): Flow<List<LeaveRequest>> =
        firestore.collectionGroup("leave_requests")
            .whereEqualTo("status", "pending")
            .orderBy("submittedAt", Query.Direction.ASCENDING)
            .snapshotsAsFlow()
            .map { snap -> snap.documents.mapNotNull { LeaveRequest.fromDocument(it) } }

    /**
     * Deliberately awaited, unlike [submitLeaveRequest] — do not "fix" the asymmetry.
     *
     * This writes to *another user's* document, so it is the one leave path Firestore rules can
     * refuse, and a permission-denied only surfaces from the server. Reporting success for an
     * approval that the rules then reject would leave an admin believing a request was granted
     * when it was not. An employee submitting their own leave is writing where they are already
     * permitted, so returning before the round-trip costs nothing there. Approvals also happen
     * at a desk, where a spinner is a fair price for a truthful answer.
     */
    override suspend fun approveLeave(
        targetUserId: String,
        requestId: String,
        approverName: String
    ): Result<Unit> {
        return try {
            firestore.collection("users").document(targetUserId)
                .collection("leave_requests").document(requestId)
                // Stampable: the leave update rule is admin / Leaves-manager with no hasOnly.
                // approvedBy stays untouched — it names the decision-maker; lastModifiedBy names
                // the auth uid that actually performed the write.
                .update(mapOf(
                    "status"     to "approved",
                    "approvedBy" to approverName,
                    "reviewedAt" to Timestamp.now()
                ).withAuditStamp(AuditStamp.uid(sessionManager)))
                .await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun rejectLeave(
        targetUserId: String,
        requestId: String,
        approverName: String,
        comment: String
    ): Result<Unit> {
        return try {
            firestore.collection("users").document(targetUserId)
                .collection("leave_requests").document(requestId)
                // Stampable: same rule as approveLeave — no hasOnly on leave_requests update.
                .update(mapOf(
                    "status"          to "rejected",
                    "approvedBy"      to approverName,
                    "approverComment" to comment,
                    "reviewedAt"      to Timestamp.now()
                ).withAuditStamp(AuditStamp.uid(sessionManager)))
                .await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
