package com.raghav.whitecoffee.data.session

/**
 * The signed-in user's cached identity.
 *
 * WHY THIS IS AN INTERFACE: the implementation is backed by SharedPreferences, which the
 * Android architecture guidance names as a data source the UI layer must not depend on
 * concretely, and which needs a Context to open. Five ViewModels read this type, so faking it
 * is what lets them be constructed on a JVM test runner.
 *
 * Every property is read-only. Identity changes go through [saveSession], [tryRestoreFromCache]
 * and [clearSession] — a single source of truth that callers may read but never mutate field by
 * field.
 */
interface SessionManager {

    val userId: String
    val name: String
    val email: String
    val role: String
    val employeeId: String
    val sessionToken: String

    /** True if a user is currently signed in AND session data is populated. */
    val isLoggedIn: Boolean

    /** True if the current user has the operations role. */
    val isOperations: Boolean

    /** True if the current user has the office role (admin also has all office capabilities). */
    val isOffice: Boolean

    /**
     * True if the current user has the sales role. Sales is a hybrid: it may do either an
     * office day (office_in/office_out) or a site-visit day (site_in/site_out), chosen per day.
     * It is scored on the fixed 10:00–18:00 window like office (see RoleCapabilities).
     *
     * Never fold sales into [isOffice] or infer it from `!isOperations` — that binary is what
     * left a sales site day unregularizable and a `site_in` unclosed at logout.
     */
    val isSales: Boolean

    /** True if the current user has the admin role. */
    val isAdmin: Boolean

    /**
     * Called after successful Firebase Auth + Firestore user document fetch.
     * Caches all identity fields.
     */
    fun saveSession(
        userId: String,
        name: String,
        email: String,
        role: String,
        employeeId: String,
        sessionToken: String = ""
    )

    /**
     * Restores the cache from persistent storage. Called on app launch to skip the Firestore
     * round-trip. Returns true if a session was restored.
     */
    fun tryRestoreFromCache(): Boolean

    /** Clears the cached identity and signs the user out. */
    fun clearSession()

    companion object {
        const val ROLE_OPERATIONS = "operations"
        const val ROLE_OFFICE     = "office"
        const val ROLE_SALES      = "sales"
        const val ROLE_ADMIN      = "admin"
    }
}
