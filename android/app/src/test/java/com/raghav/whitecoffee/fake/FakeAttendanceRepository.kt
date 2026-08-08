package com.raghav.whitecoffee.fake

import com.google.firebase.Timestamp
import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import com.raghav.whitecoffee.data.model.deriveAttendanceState
import com.raghav.whitecoffee.data.repository.AttendanceRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import java.util.Date

/**
 * In-memory [AttendanceRepository] for unit tests.
 *
 * A fake, not a mock: it actually behaves like the real thing (appends events, derives state
 * from them) rather than replaying scripted answers, so a test that passes against it is
 * evidence about the ViewModel's logic and not about the test's own stubbing.
 */
class FakeAttendanceRepository(
    initialEvents: List<AttendanceRecord> = emptyList()
) : AttendanceRepository {

    private val events = MutableStateFlow(initialEvents)

    /** Every event the subject recorded, in order. Assertions read this. */
    val recorded: List<AttendanceRecord> get() = events.value

    /** When set, every call fails with this error — for exercising failure branches. */
    var failWith: Exception? = null

    /**
     * When set, [observeTodayData] throws this instead of emitting — for exercising a
     * ViewModel's `catch {}` branch on the live stream, as distinct from [failWith] which only
     * affects the suspending one-shot calls.
     */
    var flowFailWith: Throwable? = null

    /** Planned window handed back by [getTodayPlannedWindow]; null means "no shift set". */
    var plannedWindow: Pair<Int, Int>? = null

    /** Clock used to stamp recorded events, so tests can control ordering. */
    var now: () -> Timestamp = { Timestamp(Date(0L)) }

    /**
     * The `date` stamped on recorded events — the real repository reads this from the injected
     * Clock at write time. A rollover test sets this to the NEW day while the events already held
     * carry the old one, which is exactly the production shape of the bug.
     */
    var today: String = "2026-07-25"

    /** How many times a caller re-read the day. Asserts that a stale screen actually reloaded. */
    var loads: Int = 0
        private set

    /** Replaces the stored events — lets a test simulate a new day's data arriving underneath. */
    fun setEvents(newEvents: List<AttendanceRecord>) {
        events.value = newEvents
    }

    override suspend fun getTodayData(): Result<Pair<AttendanceState, List<AttendanceRecord>>> {
        loads++
        failWith?.let { return Result.failure(it) }
        val current = events.value
        return Result.success(deriveAttendanceState(current) to current)
    }

    override fun observeTodayData(): Flow<Pair<AttendanceState, List<AttendanceRecord>>> {
        loads++
        return events.map {
            flowFailWith?.let { err -> throw err }
            deriveAttendanceState(it) to it
        }
    }

    override suspend fun getTodayPlannedWindow(): Result<Pair<Int, Int>?> {
        failWith?.let { return Result.failure(it) }
        return Result.success(plannedWindow)
    }

    override suspend fun recordEvent(
        type: String,
        latitude: Double,
        longitude: Double,
        siteId: String,
        siteName: String,
        marketName: String,
        locationName: String
    ): Result<AttendanceRecord> {
        failWith?.let { return Result.failure(it) }
        val record = AttendanceRecord(
            id           = "evt-${events.value.size + 1}",
            userId       = "u1",
            employeeId   = "EMP001",
            userName     = "Test User",
            date         = today,
            type         = type,
            timestamp    = now(),
            latitude     = latitude,
            longitude    = longitude,
            siteId       = siteId,
            siteName     = siteName,
            marketName   = marketName,
            locationName = locationName
        )
        events.value = events.value + record
        return Result.success(record)
    }
}
