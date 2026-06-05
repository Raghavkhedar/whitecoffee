package com.raghav.whitecoffee.data.repository

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.raghav.whitecoffee.data.model.User
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.tasks.await
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
            // Step 1 — Firebase Auth sign in
            val authResult = auth.signInWithEmailAndPassword(
                email.lowercase().trim(),
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

            // Step 3 — Populate SessionManager so every screen has instant access
            sessionManager.saveSession(
                userId     = user.id,
                name       = user.name,
                email      = user.email,
                role       = user.role,
                employeeId = user.employeeId
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
}