package com.raghav.whitecoffee.fake

import com.raghav.whitecoffee.data.session.SessionManager

/**
 * In-memory [SessionManager]. The real one needs a Context to open SharedPreferences.
 *
 * Construct it with the role under test — role-dependent behaviour is where this app's most
 * expensive bugs have lived, and `sales` in particular must never be inferred from
 * `!isOperations`.
 */
class FakeSessionManager(
    override var role: String = SessionManager.ROLE_OPERATIONS,
    override var userId: String = "u1",
    override var name: String = "Test User",
    override var email: String = "test@whitecoffee.com",
    override var employeeId: String = "EMP001",
    override var sessionToken: String = "token-1",
    override var isLoggedIn: Boolean = true
) : SessionManager {

    override val isOperations: Boolean get() = role == SessionManager.ROLE_OPERATIONS
    override val isOffice: Boolean
        get() = role == SessionManager.ROLE_OFFICE || role == SessionManager.ROLE_ADMIN
    override val isSales: Boolean get() = role == SessionManager.ROLE_SALES
    override val isAdmin: Boolean get() = role == SessionManager.ROLE_ADMIN

    var cleared: Boolean = false
        private set

    override fun saveSession(
        userId: String,
        name: String,
        email: String,
        role: String,
        employeeId: String,
        sessionToken: String
    ) {
        this.userId = userId
        this.name = name
        this.email = email.lowercase().trim()
        this.role = role
        this.employeeId = employeeId
        this.sessionToken = sessionToken
        this.isLoggedIn = true
    }

    override fun tryRestoreFromCache(): Boolean = userId.isNotEmpty()

    override fun clearSession() {
        cleared = true
        isLoggedIn = false
        userId = ""
        role = ""
    }
}
