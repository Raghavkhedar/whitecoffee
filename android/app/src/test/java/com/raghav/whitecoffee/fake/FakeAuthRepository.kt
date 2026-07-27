package com.raghav.whitecoffee.fake

import com.raghav.whitecoffee.data.model.User
import com.raghav.whitecoffee.data.repository.AuthRepository

/**
 * In-memory [AuthRepository]. The real one talks to Firebase Auth.
 *
 * [logoutCount] is recorded rather than just flagged so a test can prove logout ran exactly
 * once — the auto-checkout path has a re-entrancy guard whose whole job is to stop it running
 * twice.
 */
class FakeAuthRepository(
    var loggedIn: Boolean = true,
    var loginResult: Result<User> = Result.success(
        User(
            id = "u1", name = "Test User", email = "test@whitecoffee.com",
            role = "operations", employeeId = "EMP001"
        )
    )
) : AuthRepository {

    var logoutCount: Int = 0
        private set

    /** How many times [login] actually reached this fake — proves local validation short-circuited. */
    var loginCallCount: Int = 0
        private set

    override suspend fun login(email: String, password: String): Result<User> {
        loginCallCount++
        return loginResult
    }

    override fun logout() {
        logoutCount++
        loggedIn = false
    }

    override fun isLoggedIn(): Boolean = loggedIn
}
