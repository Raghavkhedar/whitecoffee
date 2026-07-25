package com.raghav.whitecoffee.data.repository

import com.raghav.whitecoffee.data.model.User

/**
 * Authentication and the signed-in user's profile.
 *
 * Implemented by [FirebaseAuthRepository] in production, faked in tests.
 */
interface AuthRepository {

    /**
     * Signs in and loads the user's profile document. Never throws — auth and profile
     * failures come back as [Result.failure] with a message safe to show a user.
     */
    suspend fun login(email: String, password: String): Result<User>

    /** Signs out and clears the cached session. */
    fun logout()

    /** True if Firebase Auth still holds a valid user. */
    fun isLoggedIn(): Boolean
}
