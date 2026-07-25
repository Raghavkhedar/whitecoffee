package com.raghav.whitecoffee.data.repository

import com.raghav.whitecoffee.data.model.AttendanceRecord
import com.raghav.whitecoffee.data.model.AttendanceState
import kotlinx.coroutines.flow.Flow

/**
 * Attendance events for the signed-in user — the app's highest-consequence data.
 *
 * WHY THIS IS AN INTERFACE: five ViewModels depend on this type (Attendance, OfficeAttendance,
 * Home, Regularization, Main). While it was a concrete Firestore-backed class, none of them
 * could be exercised in a unit test, so the attendance state machines — the logic that decides
 * whether someone is paid for a day — were verified only by hand. Faking this contract is what
 * makes those tests possible.
 *
 * Implemented by [FirestoreAttendanceRepository] in production and by FakeAttendanceRepository
 * in tests.
 */
interface AttendanceRepository {

    /**
     * Single query for today's events — returns both the derived state and the full event list.
     * Never throws; failures come back as [Result.failure].
     */
    suspend fun getTodayData(): Result<Pair<AttendanceState, List<AttendanceRecord>>>

    /** Live version of [getTodayData]: re-emits whenever today's attendance docs change. */
    fun observeTodayData(): Flow<Pair<AttendanceState, List<AttendanceRecord>>>

    /**
     * Today's admin-set planned shift window for this (operations) user. Returns:
     *  - success(null)        → no plan set,
     *  - success((start,end)) → resolved minutes-of-day window.
     * Office/admin/sales don't use this — their window is a fixed 10:00–18:00.
     */
    suspend fun getTodayPlannedWindow(): Result<Pair<Int, Int>?>

    /**
     * Records a single attendance event. Returns the full record with the generated document ID
     * so callers can do optimistic state updates without a re-fetch.
     *
     * Offline-first by contract: implementations MUST NOT await a server round-trip. A punch
     * made at a site with no signal has to be durable locally and sync later — awaiting would
     * hang the check-in spinner indefinitely and, worse, risk losing the punch entirely.
     */
    suspend fun recordEvent(
        type: String,
        latitude: Double,
        longitude: Double,
        siteId: String = "",
        siteName: String = "",
        marketName: String = "",
        locationName: String = ""
    ): Result<AttendanceRecord>
}
