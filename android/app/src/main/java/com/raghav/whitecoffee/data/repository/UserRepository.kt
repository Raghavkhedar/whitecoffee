package com.raghav.whitecoffee.data.repository

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.raghav.whitecoffee.data.firestore.AuditStamp
import com.raghav.whitecoffee.data.firestore.withAuditStamp
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
        id         = sessionManager.userId,
        name       = sessionManager.name,
        email      = sessionManager.email,
        role       = sessionManager.role,
        employeeId = sessionManager.employeeId
    )

    // ── Admin operations ──────────────────────────────────────────────────

    suspend fun getAllUsers(): Result<List<User>> {
        return try {
            val snapshot = firestore.collection("users").get().await()
            Result.success(snapshot.documents.mapNotNull { User.fromDocument(it) })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun createUser(
        email: String,
        password: String,
        name: String,
        role: String,
        employeeId: String
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

            // Stampable: user CREATE is admin-only and unrestricted in field set. The
            // changedKeysWithin(['activeSessionToken','fcmToken']) restriction applies only to
            // the non-admin owner UPDATE branch, so it does not bite here. lastModifiedBy is the
            // ADMIN's uid (the actor) — `userId` above still identifies the created account.
            firestore.collection("users").document(uid).set(
                mapOf(
                    "userId"     to uid,
                    "name"       to name.trim(),
                    "email"      to email.lowercase().trim(),
                    "role"       to role,
                    "employeeId" to employeeId.trim(),
                    "createdAt"  to Timestamp.now()
                ).withAuditStamp(AuditStamp.uid(sessionManager))
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
        employeeId: String
    ): Result<Unit> {
        return try {
            // Stampable: this profile patch (name/role/employeeId) is reachable ONLY on the
            // isAdmin() branch of the user-doc update rule, which has no field-set restriction.
            // The hasOnly(['activeSessionToken','fcmToken']) branch is the non-admin owner path
            // and is not used here.
            firestore.collection("users").document(userId).update(
                mapOf(
                    "name"       to name.trim(),
                    "role"       to role,
                    "employeeId" to employeeId.trim()
                ).withAuditStamp(AuditStamp.uid(sessionManager))
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
