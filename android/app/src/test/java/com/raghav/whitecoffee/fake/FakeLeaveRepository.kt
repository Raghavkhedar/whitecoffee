package com.raghav.whitecoffee.fake

import com.raghav.whitecoffee.data.model.LeaveRequest
import com.raghav.whitecoffee.data.repository.LeaveRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

/**
 * In-memory [LeaveRepository] for unit tests.
 *
 * A fake, not a mock: approving a request actually removes it from the pending stream, so a
 * test that asserts on the queue is exercising the ViewModel and not its own stubbing.
 *
 * The pending stream is a [MutableStateFlow], which is what makes it useful for the offline
 * tests: it emits regardless of connectivity, exactly like a Firestore listener backed by the
 * persistent cache. A ViewModel that refuses to subscribe when offline sees nothing from it.
 */
class FakeLeaveRepository(
    initialPending: List<LeaveRequest> = emptyList()
) : LeaveRepository {

    private val pending = MutableStateFlow(initialPending)

    /** Requests approved by the subject, in order. */
    val approved = mutableListOf<String>()

    /** Requests rejected by the subject, paired with the comment given. */
    val rejected = mutableListOf<Pair<String, String>>()

    /** Every request handed to [submitLeaveRequest], in order — reads for field assertions. */
    val submitted = mutableListOf<LeaveRequest>()

    /** When set, every suspending call fails with this error. */
    var failWith: Exception? = null

    /**
     * When set, both observe flows throw this instead of emitting — for exercising a
     * ViewModel's `catch {}` branch, as distinct from [failWith] which only affects the
     * suspending one-shot calls.
     */
    var flowFailWith: Throwable? = null

    fun setPending(list: List<LeaveRequest>) { pending.value = list }

    override suspend fun submitLeaveRequest(request: LeaveRequest): Result<String> {
        failWith?.let { return Result.failure(it) }
        submitted += request
        return Result.success(request.id.ifEmpty { "generated-id" })
    }

    private fun stream(): Flow<List<LeaveRequest>> = pending.map {
        flowFailWith?.let { err -> throw err }
        it
    }

    override fun observeMyLeaveRequests(): Flow<List<LeaveRequest>> = stream()

    override fun observePendingLeaveRequests(): Flow<List<LeaveRequest>> = stream()

    override suspend fun approveLeave(
        targetUserId: String,
        requestId: String,
        approverName: String
    ): Result<Unit> {
        failWith?.let { return Result.failure(it) }
        approved += requestId
        pending.value = pending.value.filterNot { it.id == requestId }
        return Result.success(Unit)
    }

    override suspend fun rejectLeave(
        targetUserId: String,
        requestId: String,
        approverName: String,
        comment: String
    ): Result<Unit> {
        failWith?.let { return Result.failure(it) }
        rejected += requestId to comment
        pending.value = pending.value.filterNot { it.id == requestId }
        return Result.success(Unit)
    }
}
