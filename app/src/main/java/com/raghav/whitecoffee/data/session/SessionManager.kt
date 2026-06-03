package com.raghav.whitecoffee.data.session

import com.google.firebase.auth.FirebaseAuth
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Single source of truth for the currently authenticated user's identity.
 *
 * Populated once at login — every screen reads from here instead of
 * re-querying Firestore by email. This is the correct fix for the v2
 * name/email display bugs.
 *
 * Cleared on logout so stale data never bleeds into a new session.
 */
@Singleton
class SessionManager @Inject constructor(
    private val firebaseAuth: FirebaseAuth
) {

    // In-memory cache of the current user's Firestore profile fields
    private var _userId: String = ""
    private var _name: String = ""
    private var _email: String = ""
    private var _role: String = ""
    private var _employeeId: String = ""
    private var _assignedSites: List<String> = emptyList()

    val userId: String get() = _userId
    val name: String get() = _name
    val email: String get() = _email
    val role: String get() = _role
    val employeeId: String get() = _employeeId
    val assignedSites: List<String> get() = _assignedSites

    /** True if a user is currently signed in AND session data is populated. */
    val isLoggedIn: Boolean
        get() = firebaseAuth.currentUser != null && _userId.isNotEmpty()

    /** True if the current user has the operations role. */
    val isOperations: Boolean
        get() = _role == ROLE_OPERATIONS

    /** True if the current user has the office role. */
    val isOffice: Boolean
        get() = _role == ROLE_OFFICE

    /**
     * Called by LoginViewModel after successful Firebase Auth + Firestore
     * user document fetch. Caches all identity fields in memory.
     */
    fun saveSession(
        userId: String,
        name: String,
        email: String,
        role: String,
        employeeId: String,
        assignedSites: List<String>
    ) {
        _userId = userId
        _name = name
        _email = email.lowercase().trim()
        _role = role
        _employeeId = employeeId
        _assignedSites = assignedSites
    }

    /**
     * Called on logout. Clears all cached identity and signs out of Firebase.
     * After this call, isLoggedIn returns false immediately.
     */
    fun clearSession() {
        _userId = ""
        _name = ""
        _email = ""
        _role = ""
        _employeeId = ""
        _assignedSites = emptyList()
        firebaseAuth.signOut()
    }

    companion object {
        const val ROLE_OPERATIONS = "operations"
        const val ROLE_OFFICE = "office"
    }
}