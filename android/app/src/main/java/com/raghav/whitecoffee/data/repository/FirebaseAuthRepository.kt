package com.raghav.whitecoffee.data.repository

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.raghav.whitecoffee.data.model.User
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.tasks.await
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val auth: FirebaseAuth,
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) {

    /**
     * Signs in with email/password, then immediately fetches the user's
     * Firestore profile and populates SessionManager.
     * Returns Result.success(User) or Result.failure(exception).
     */
    suspend fun login(email: String, password: String): Result<User> {
        return try {
            // Step 1 — Resolve the login identifier, then Firebase Auth sign in.
            // New hires log in with just their employee ID (turned into a synthetic
            // email); existing users still type their real email. See resolveLoginEmail().
            val authResult = auth.signInWithEmailAndPassword(
                resolveLoginEmail(email),
                password
            ).await()

            val firebaseUser = authResult.user
                ?: return Result.failure(Exception("Authentication failed. Please try again."))

            // Step 2 — Fetch Firestore user profile
            val doc = firestore
                .collection("users")
                .document(firebaseUser.uid)
                .get()
                .await()

            val user = User.fromDocument(doc)
                ?: return Result.failure(Exception("User profile not found. Contact your administrator."))

            // Step 3 — Generate a unique session token, write to Firestore, and cache locally.
            // Any other device holding a different token will be kicked out.
            // NOTE: deliberately NOT awaited. With Firestore offline persistence a write Task
            // only completes on server ack, so awaiting here would hang/fail offline logins.
            // The local SDK queues it and syncs when connectivity returns (offline-first design).
            //
            // ⚠️ AUDIT-EXEMPT — deliberately NOT stamped with lastModifiedBy/lastModifiedAt.
            // firestore.rules allows a non-admin to update their own user doc only when
            // changedKeysWithin(['activeSessionToken', 'fcmToken']) holds — that is hasOnly,
            // so ANY third key makes this write PERMISSION_DENIED and single-device session
            // enforcement (and therefore login) breaks. The audit log still identifies this
            // write by path (users/{uid}) and the value is redacted there anyway.
            val sessionToken = UUID.randomUUID().toString()
            firestore.collection("users").document(user.id)
                .update("activeSessionToken", sessionToken)

            // Step 4 — Populate SessionManager so every screen has instant access
            sessionManager.saveSession(
                userId       = user.id,
                name         = user.name,
                email        = user.email,
                role         = user.role,
                employeeId   = user.employeeId,
                sessionToken = sessionToken
            )

            Result.success(user)

        } catch (e: Exception) {
            Result.failure(mapAuthException(e))
        }
    }

    /**
     * Signs out and clears all session data.
     */
    fun logout() {
        sessionManager.clearSession()
    }

    /**
     * Returns true if a Firebase user is currently signed in
     * AND session data is populated.
     */
    fun isLoggedIn(): Boolean {
        if (auth.currentUser == null) return false
        if (sessionManager.isLoggedIn) return true
        // Firebase user exists but in-memory cache is empty (process was killed)
        // Try restoring from SharedPreferences — avoids a Firestore round-trip
        return sessionManager.tryRestoreFromCache()
    }

    /**
     * Maps Firebase exception messages to user-friendly strings.
     */
    private fun mapAuthException(e: Exception): Exception {
        val message = when {
            e.message?.contains("password") == true ->
                "Incorrect password. Please try again."
            e.message?.contains("no user record") == true ||
                    e.message?.contains("user-not-found") == true ->
                "No account found with this email."
            e.message?.contains("network") == true ->
                "Network error. Check your connection and try again."
            e.message?.contains("too-many-requests") == true ->
                "Too many failed attempts. Please try again later."
            else ->
                "Login failed. Please try again."
        }
        return Exception(message)
    }

    companion object {
        /**
         * Synthetic login domain for employee-ID logins (Session 31).
         *
         * Company email addresses get recycled between employees, so email can't be a
         * stable identity. New hires instead log in with just their employee ID, which the
         * app turns into a synthetic Firebase Auth email of the form "<empId>@<this domain>".
         * These addresses never need to be real mailboxes — they exist only as login keys,
         * so we never run out and a reused real email never collides with an account.
         *
         * ⚠️ MUST exactly match the domain the admin portal uses when it creates new
         * accounts. If you change it here, change it there too, or new hires can't log in.
         */
        const val LOGIN_EMAIL_DOMAIN = "whitecoffee.internal"

        /**
         * Resolves a raw login identifier (as typed on the login screen) into the email
         * Firebase Auth expects.
         *  - Contains "@" → treated as a full email (existing real-email users) → used as-is.
         *  - Otherwise    → treated as an employee ID → "<id>@$LOGIN_EMAIL_DOMAIN".
         * Always lowercased + trimmed so "EMP001" and " emp001 " resolve identically.
         */
        fun resolveLoginEmail(identifier: String): String {
            val trimmed = identifier.trim().lowercase()
            return if (trimmed.contains("@")) trimmed else "$trimmed@$LOGIN_EMAIL_DOMAIN"
        }
    }
}