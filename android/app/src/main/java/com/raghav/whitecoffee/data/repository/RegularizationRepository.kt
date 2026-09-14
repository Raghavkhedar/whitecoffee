package com.raghav.whitecoffee.data.repository

import com.raghav.whitecoffee.data.model.RegularizationRequest
import kotlinx.coroutines.flow.Flow

/**
 * Attendance regularization requests raised by the employee and decided by an admin.
 *
 * Implemented by [FirestoreRegularizationRepository] in production, faked in tests.
 */
interface RegularizationRepository {

    /** Live stream of this user's request for [date], if any. */
    fun observeRequestForDate(date: String): Flow<RegularizationRequest?>

    /**
     * Submits a request for [date]. Fails if the reason is blank, if a pending or already
     * approved request exists for that date (duplicate prevention lives here, not in the UI),
     * or if [date] is a Protocol 1 rest day (a Sunday, or a company holiday per [isHoliday]) —
     * rest days are immutable, so a regularization there could never be approved to anything;
     * rest-day work goes through OT approval instead (see FirestoreRegularizationRepository for
     * detail). Rest-day-ness is derived from the DATE itself, never from the stored
     * attendance_status doc — that doc is written only by the nightly 23:59 IST run, so it does
     * not exist yet for any rest day still in progress.
     */
    suspend fun submitRequest(
        date: String,
        originalStatus: String,
        reason: String
    ): Result<String>

    /** Live read of the admin-controlled past-date window (`config/regularizationWindow`). */
    fun observeWindowOpen(): Flow<Boolean>

    /**
     * The stored daily status for [date] (`users/{uid}/attendance_status/{date}.status`), or
     * null if no such doc exists yet (a Sunday/holiday/unscored day, or a date before the app's
     * status backfill).
     */
    suspend fun getStatusForDate(date: String): String?

    /**
     * True if [date] ("yyyy-MM-dd") has a company holiday doc at `holidays/{date}`. Combined
     * with a pure Sunday-of-date check (holiday wins, mirroring `resolveRestDayType` in
     * `firebase/functions/attendanceRules.js` and `isRestDay` in `admin/src/lib/firestore.ts`)
     * to decide whether [date] is a Protocol 1 rest day — see [submitRequest].
     */
    suspend fun isHoliday(date: String): Boolean
}
