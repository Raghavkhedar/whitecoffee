package com.raghav.whitecoffee.fake

import com.google.firebase.firestore.FirebaseFirestoreException
import com.raghav.whitecoffee.data.model.RegularizationRequest
import com.raghav.whitecoffee.data.repository.RegularizationRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map

/**
 * In-memory [RegularizationRepository] for unit tests.
 *
 * A fake, not a mock: [submitRequest] actually enforces the contract's own duplicate-prevention
 * rule ("fails if... a pending or already approved request exists for that date") by checking
 * the same in-memory map [observeRequestForDate] reads from, rather than returning a scripted
 * result — so a test asserting the refusal is exercising real state, not stubbing.
 */
class FakeRegularizationRepository(
    initialRequests: Map<String, RegularizationRequest> = emptyMap(),
    windowOpen: Boolean = false,
) : RegularizationRepository {

    private val requests = MutableStateFlow(initialRequests)
    private val windowOpenFlow = MutableStateFlow(windowOpen)
    private val statusByDate = mutableMapOf<String, String>()

    /** When set, every call fails with this error instead of running the normal logic. */
    var failWith: Exception? = null

    /** When set, [getStatusForDate] throws this instead of returning normally. */
    var failStatusLookup: Exception? = null

    /** Every request the subject successfully submitted, in order. */
    val submitted = mutableListOf<RegularizationRequest>()

    private var nextId = 1

    /** Seeds (or clears, with null) the request on file for [date]. */
    fun setRequestForDate(date: String, request: RegularizationRequest?) {
        requests.value = if (request == null) requests.value - date else requests.value + (date to request)
    }

    /** Flips the fake window state; [observeWindowOpen] reflects it immediately. */
    fun setWindowOpen(open: Boolean) { windowOpenFlow.value = open }

    /**
     * How many times [observeWindowOpen] has been subscribed to. A retry shows up here as a
     * second subscription, which is what distinguishes "retried" from "gave up".
     */
    var windowSubscriptions = 0
        private set

    /**
     * Number of leading [observeWindowOpen] subscriptions that should fail before one succeeds,
     * mimicking a Firestore listener that errors (denied, offline, token not yet attached).
     * The real listener terminates the flow on error — the fake must too, or it cannot
     * reproduce the latch this exists to catch.
     */
    var windowFailuresBeforeSuccess = 0

    /** Seeds (or clears, with null) the historical status [getStatusForDate] returns for [date]. */
    fun setStatusForDate(date: String, status: String?) {
        if (status == null) statusByDate.remove(date) else statusByDate[date] = status
    }

    override fun observeRequestForDate(date: String): Flow<RegularizationRequest?> =
        requests.map { it[date] }

    override fun observeWindowOpen(): Flow<Boolean> = flow {
        val attempt = windowSubscriptions++
        if (attempt < windowFailuresBeforeSuccess) {
            throw FirebaseFirestoreException(
                "PERMISSION_DENIED",
                FirebaseFirestoreException.Code.PERMISSION_DENIED,
            )
        }
        emitAll(windowOpenFlow)
    }

    override suspend fun getStatusForDate(date: String): String? {
        failStatusLookup?.let { throw it }
        return statusByDate[date]
    }

    override suspend fun submitRequest(
        date: String,
        originalStatus: String,
        reason: String
    ): Result<String> {
        failWith?.let { return Result.failure(it) }
        if (reason.isBlank()) {
            return Result.failure(IllegalArgumentException("Please provide a reason."))
        }
        val existing = requests.value[date]
        if (existing != null && existing.status != "rejected") {
            return Result.failure(IllegalStateException("A request for this date already exists."))
        }
        val id = "reg-${nextId++}"
        val request = RegularizationRequest(
            id = id,
            date = date,
            originalStatus = originalStatus,
            reason = reason,
            status = "pending",
        )
        requests.value = requests.value + (date to request)
        submitted += request
        return Result.success(id)
    }
}
