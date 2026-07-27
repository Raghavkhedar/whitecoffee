package com.raghav.whitecoffee.data.repository

import com.raghav.whitecoffee.data.model.AccountSnapshot
import com.raghav.whitecoffee.data.model.User
import kotlinx.coroutines.flow.Flow

/**
 * Employee profiles.
 *
 * The admin write paths exist but are unused by the app — user management is web-portal only.
 *
 * Implemented by [FirestoreUserRepository] in production, faked in tests.
 */
interface UserRepository {

    suspend fun getUserById(userId: String): Result<User>

    /** The signed-in user, assembled from the cached session — no network round-trip. */
    fun getCurrentUser(): User

    /**
     * Live view of one user's account document: suspension state plus the active session token.
     *
     * The app root collects this to enforce the single-device rule and to raise the suspension
     * overlay. Emissions that carry no readable document are dropped rather than surfaced, so a
     * transient listener error never signs anyone out — being unable to confirm a session is not
     * evidence that it was replaced.
     */
    fun observeAccount(userId: String): Flow<AccountSnapshot>

    suspend fun getAllUsers(): Result<List<User>>

    suspend fun createUser(
        email: String,
        password: String,
        name: String,
        role: String,
        employeeId: String
    ): Result<String>

    suspend fun updateUserProfile(
        userId: String,
        name: String,
        role: String,
        employeeId: String
    ): Result<Unit>

    suspend fun sendPasswordResetEmail(email: String): Result<Unit>
}
