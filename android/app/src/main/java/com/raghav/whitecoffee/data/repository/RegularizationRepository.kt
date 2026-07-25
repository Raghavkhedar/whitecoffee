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
     * Submits a request for [date]. Fails if the reason is blank, or if a pending or already
     * approved request exists for that date — duplicate prevention lives here, not in the UI.
     */
    suspend fun submitRequest(
        date: String,
        originalStatus: String,
        reason: String
    ): Result<String>
}
