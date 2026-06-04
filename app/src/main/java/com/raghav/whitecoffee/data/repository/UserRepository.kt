package com.raghav.whitecoffee.data.repository

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.raghav.whitecoffee.data.model.User
import com.raghav.whitecoffee.data.session.SessionManager
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) {

    suspend fun getUserById(userId: String): Result<User> {
        return try {
            val doc = firestore.collection("users").document(userId).get().await()
            val user = User.fromDocument(doc) ?: return Result.failure(Exception("User not found."))
            Result.success(user)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun getCurrentUser(): User = User(
        id            = sessionManager.userId,
        name          = sessionManager.name,
        email         = sessionManager.email,
        role          = sessionManager.role,
        employeeId    = sessionManager.employeeId,
        assignedSites = sessionManager.assignedSites
    )

    suspend fun getUsersForSite(siteId: String): Result<List<User>> {
        return try {
            val snapshot = firestore.collection("users")
                .whereArrayContains("assignedSites", siteId)
                .get()
                .await()
            Result.success(snapshot.documents.mapNotNull { User.fromDocument(it) })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ── Admin operations ──────────────────────────────────────────────────

    suspend fun getAllUsers(): Result<List<User>> {
        return try {
            val snapshot = firestore.collection("users").get().await()
            Result.success(snapshot.documents.mapNotNull { User.fromDocument(it) })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Creates a new Firebase Auth user + Firestore profile atomically.
     * Uses a secondary Firebase app instance so the admin session is never interrupted.
     */
    suspend fun createUser(
        email: String,
        password: String,
        name: String,
        role: String,
        employeeId: String,
        assignedSites: List<String>
    ): Result<String> {
        val secondaryApp = FirebaseApp.initializeApp(
            context,
            FirebaseApp.getInstance().options,
            "adminCreate_${System.currentTimeMillis()}"
        )
        return try {
            val secondaryAuth = FirebaseAuth.getInstance(secondaryApp)
            val authResult = secondaryAuth
                .createUserWithEmailAndPassword(email.lowercase().trim(), password)
                .await()
            val uid = authResult.user?.uid
                ?: return Result.failure(Exception("Failed to obtain user ID."))

            firestore.collection("users").document(uid).set(
                mapOf(
                    "userId"        to uid,
                    "name"          to name.trim(),
                    "email"         to email.lowercase().trim(),
                    "role"          to role,
                    "employeeId"    to employeeId.trim(),
                    "assignedSites" to assignedSites,
                    "createdAt"     to Timestamp.now()
                )
            ).await()

            secondaryAuth.signOut()
            Result.success(uid)
        } catch (e: Exception) {
            Result.failure(e)
        } finally {
            secondaryApp.delete()
        }
    }

    suspend fun updateUserProfile(
        userId: String,
        name: String,
        role: String,
        employeeId: String,
        assignedSites: List<String>
    ): Result<Unit> {
        return try {
            firestore.collection("users").document(userId).update(
                mapOf(
                    "name"          to name.trim(),
                    "role"          to role,
                    "employeeId"    to employeeId.trim(),
                    "assignedSites" to assignedSites
                )
            ).await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun sendPasswordResetEmail(email: String): Result<Unit> {
        return try {
            FirebaseAuth.getInstance().sendPasswordResetEmail(email).await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
