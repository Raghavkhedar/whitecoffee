package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.raghav.whitecoffee.data.firestore.snapshotsAsFlow
import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class LeaveRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) {
    private val userDoc  get() = firestore.collection("users").document(sessionManager.userId)
    private val leaveCol get() = userDoc.collection("leave_requests")

    suspend fun submitLeaveRequest(request: LeaveRequest): Result<String> {
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
            val ref = leaveCol.add(data.toMap()).await()
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun observeMyLeaveRequests(): Flow<List<LeaveRequest>> =
        leaveCol.orderBy("submittedAt", Query.Direction.DESCENDING)
            .snapshotsAsFlow()
            .map { snap -> snap.documents.mapNotNull { LeaveRequest.fromDocument(it) } }

    // Office/admin only — collectionGroup across all users.
    // Requires Firestore index: leave_requests / status ASC + submittedAt ASC
    fun observePendingLeaveRequests(): Flow<List<LeaveRequest>> =
        firestore.collectionGroup("leave_requests")
            .whereEqualTo("status", "pending")
            .orderBy("submittedAt", Query.Direction.ASCENDING)
            .snapshotsAsFlow()
            .map { snap -> snap.documents.mapNotNull { LeaveRequest.fromDocument(it) } }

    suspend fun approveLeave(
        targetUserId: String,
        requestId: String,
        approverName: String
    ): Result<Unit> {
        return try {
            firestore.collection("users").document(targetUserId)
                .collection("leave_requests").document(requestId)
                .update(mapOf(
                    "status"     to "approved",
                    "approvedBy" to approverName,
                    "reviewedAt" to Timestamp.now()
                ))
                .await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun rejectLeave(
        targetUserId: String,
        requestId: String,
        approverName: String,
        comment: String
    ): Result<Unit> {
        return try {
            firestore.collection("users").document(targetUserId)
                .collection("leave_requests").document(requestId)
                .update(mapOf(
                    "status"          to "rejected",
                    "approvedBy"      to approverName,
                    "approverComment" to comment,
                    "reviewedAt"      to Timestamp.now()
                ))
                .await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
