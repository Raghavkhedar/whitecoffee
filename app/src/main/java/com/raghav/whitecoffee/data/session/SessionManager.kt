package com.raghav.whitecoffee.data.session

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SessionManager @Inject constructor(
    private val firebaseAuth: FirebaseAuth,
    @ApplicationContext private val context: Context
) {

    private val prefs by lazy {
        context.getSharedPreferences("wc_session", Context.MODE_PRIVATE)
    }

    // In-memory cache of the current user's Firestore profile fields
    private var _userId: String = ""
    private var _name: String = ""
    private var _email: String = ""
    private var _role: String = ""
    private var _employeeId: String = ""

    val userId: String get() = _userId
    val name: String get() = _name
    val email: String get() = _email
    val role: String get() = _role
    val employeeId: String get() = _employeeId

    /** True if a user is currently signed in AND session data is populated. */
    val isLoggedIn: Boolean
        get() = firebaseAuth.currentUser != null && _userId.isNotEmpty()

    /** True if the current user has the operations role. */
    val isOperations: Boolean
        get() = _role == ROLE_OPERATIONS

    /** True if the current user has the office role (admin also has all office capabilities). */
    val isOffice: Boolean
        get() = _role == ROLE_OFFICE || _role == ROLE_ADMIN

    /** True if the current user has the admin role. */
    val isAdmin: Boolean
        get() = _role == ROLE_ADMIN

    /**
     * Called by LoginViewModel after successful Firebase Auth + Firestore
     * user document fetch. Caches all identity fields in memory.
     */
    fun saveSession(
        userId: String,
        name: String,
        email: String,
        role: String,
        employeeId: String
    ) {
        _userId = userId
        _name = name
        _email = email.lowercase().trim()
        _role = role
        _employeeId = employeeId
        prefs.edit()
            .putString("userId", _userId)
            .putString("name", _name)
            .putString("email", _email)
            .putString("role", _role)
            .putString("employeeId", _employeeId)
            .apply()
    }

    /**
     * Restores in-memory cache from SharedPreferences if Firebase Auth still
     * has a valid user. Called on app launch to skip the Firestore round-trip.
     * Returns true if session was restored successfully.
     */
    fun tryRestoreFromCache(): Boolean {
        val userId = prefs.getString("userId", "") ?: ""
        if (userId.isEmpty()) return false
        _userId     = userId
        _name       = prefs.getString("name", "") ?: ""
        _email      = prefs.getString("email", "") ?: ""
        _role       = prefs.getString("role", "") ?: ""
        _employeeId = prefs.getString("employeeId", "") ?: ""
        return true
    }

    fun clearSession() {
        _userId = ""
        _name = ""
        _email = ""
        _role = ""
        _employeeId = ""
        prefs.edit().clear().apply()
        firebaseAuth.signOut()
    }

    companion object {
        const val ROLE_OPERATIONS = "operations"
        const val ROLE_OFFICE     = "office"
        const val ROLE_ADMIN      = "admin"
    }
}