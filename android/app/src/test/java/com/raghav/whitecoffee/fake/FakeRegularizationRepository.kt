package com.raghav.whitecoffee.fake

import com.google.firebase.firestore.FirebaseFirestoreException
import com.raghav.whitecoffee.data.model.RegularizationRequest
import com.raghav.whitecoffee.data.repository.RegularizationRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import java.time.DayOfWeek
import java.time.LocalDate

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
    private val holidayDates = mutableSetOf<String>()

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

    /** Marks (or unmarks) [date] as a company holiday for [isHoliday] — independent of
     *  [setStatusForDate], since production derives rest-day-ness from the date, never the
     *  status doc (see [submitRequest]). */
    fun setHoliday(date: String, isHoliday: Boolean) {
        if (isHoliday) holidayDates.add(date) else holidayDates.remove(date)
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

    override suspend fun isHoliday(date: String): Boolean = date in holidayDates

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
        // Mirrors production: derived from the DATE (holiday lookup + pure Sunday check,
        // holiday-first), never from statusByDate — a rest day in progress has no status doc yet.
        val restDayKind = when {
            date in holidayDates -> "Holiday"
            LocalDate.parse(date).dayOfWeek == DayOfWeek.SUNDAY -> "Sunday"
            else -> null
        }
        if (restDayKind != null) {
            return Result.failure(IllegalStateException(
                "$date is a $restDayKind — a rest day. Work done on a rest day is handled " +
                    "through OT approval, not regularization."
            ))
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
