package com.raghav.whitecoffee.fake

import com.raghav.whitecoffee.data.model.RegularizationRequest
import com.raghav.whitecoffee.data.repository.RegularizationRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
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
    initialRequests: Map<String, RegularizationRequest> = emptyMap()
) : RegularizationRepository {

    private val requests = MutableStateFlow(initialRequests)

    /** When set, every call fails with this error instead of running the normal logic. */
    var failWith: Exception? = null

    /** Every request the subject successfully submitted, in order. */
    val submitted = mutableListOf<RegularizationRequest>()

    private var nextId = 1

    /** Seeds (or clears, with null) the request on file for [date]. */
    fun setRequestForDate(date: String, request: RegularizationRequest?) {
        requests.value = if (request == null) requests.value - date else requests.value + (date to request)
    }

    override fun observeRequestForDate(date: String): Flow<RegularizationRequest?> =
        requests.map { it[date] }

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
