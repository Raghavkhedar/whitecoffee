package com.raghav.whitecoffee.data.session

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * [SessionManager] backed by SharedPreferences plus an in-memory cache.
 *
 * The only class in the app that persists identity. Bound to the interface in
 * [com.raghav.whitecoffee.di.DataSourceModule].
 */
@Singleton
class PrefsSessionManager @Inject constructor(
    private val firebaseAuth: FirebaseAuth,
    @ApplicationContext private val context: Context
) : SessionManager {

    private val prefs = context.getSharedPreferences("wc_session", Context.MODE_PRIVATE)

    // In-memory cache of the current user's Firestore profile fields
    private var _userId: String = ""
    private var _name: String = ""
    private var _email: String = ""
    private var _role: String = ""
    private var _employeeId: String = ""
    private var _sessionToken: String = ""

    override val userId: String get() = _userId
    override val name: String get() = _name
    override val email: String get() = _email
    override val role: String get() = _role
    override val employeeId: String get() = _employeeId
    override val sessionToken: String get() = _sessionToken

    override val isLoggedIn: Boolean
        get() = firebaseAuth.currentUser != null && _userId.isNotEmpty()

    override val isOperations: Boolean
        get() = _role == SessionManager.ROLE_OPERATIONS

    override val isOffice: Boolean
        get() = _role == SessionManager.ROLE_OFFICE || _role == SessionManager.ROLE_ADMIN

    override val isSales: Boolean
        get() = _role == SessionManager.ROLE_SALES

    override val isAdmin: Boolean
        get() = _role == SessionManager.ROLE_ADMIN

    override fun saveSession(
        userId: String,
        name: String,
        email: String,
        role: String,
        employeeId: String,
        sessionToken: String
    ) {
        _userId = userId
        _name = name
        _email = email.lowercase().trim()
        _role = role
        _employeeId = employeeId
        _sessionToken = sessionToken
        prefs.edit()
            .putString("userId", _userId)
            .putString("name", _name)
            .putString("email", _email)
            .putString("role", _role)
            .putString("employeeId", _employeeId)
            .putString("sessionToken", _sessionToken)
            .apply()
    }

    override fun tryRestoreFromCache(): Boolean {
        val userId = prefs.getString("userId", "") ?: ""
        if (userId.isEmpty()) return false
        _userId       = userId
        _name         = prefs.getString("name", "") ?: ""
        _email        = prefs.getString("email", "") ?: ""
        _role         = prefs.getString("role", "") ?: ""
        _employeeId   = prefs.getString("employeeId", "") ?: ""
        _sessionToken = prefs.getString("sessionToken", "") ?: ""
        return true
    }

    override fun clearSession() {
        _userId = ""
        _name = ""
        _email = ""
        _role = ""
        _employeeId = ""
        _sessionToken = ""
        prefs.edit().clear().apply()
        firebaseAuth.signOut()
    }
}
