package com.raghav.whitecoffee.data.repository

import com.raghav.whitecoffee.data.model.LeaveRequest
import kotlinx.coroutines.flow.Flow

/**
 * Leave requests — the employee's own, plus the admin approval queue.
 *
 * Implemented by [FirestoreLeaveRepository] in production, faked in tests.
 */
interface LeaveRepository {

    /** Submits a request for the signed-in user. Returns the new document id. */
    suspend fun submitLeaveRequest(request: LeaveRequest): Result<String>

    /** Live stream of the signed-in user's own requests. */
    fun observeMyLeaveRequests(): Flow<List<LeaveRequest>>

    /** Live stream of every pending request across all users (admin approval queue). */
    fun observePendingLeaveRequests(): Flow<List<LeaveRequest>>

    suspend fun approveLeave(
        targetUserId: String,
        requestId: String,
        approverName: String
    ): Result<Unit>

    suspend fun rejectLeave(
        targetUserId: String,
        requestId: String,
        approverName: String,
        comment: String
    ): Result<Unit>
}
