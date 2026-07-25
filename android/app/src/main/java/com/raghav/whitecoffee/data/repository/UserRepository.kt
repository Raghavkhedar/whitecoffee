package com.raghav.whitecoffee.data.repository

import com.raghav.whitecoffee.data.model.User

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
