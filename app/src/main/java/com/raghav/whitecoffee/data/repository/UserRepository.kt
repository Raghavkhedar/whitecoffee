package com.raghav.whitecoffee.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.raghav.whitecoffee.data.model.User
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class UserRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) {

    /**
     * Fetches a user profile by Firestore document ID.
     * Used when displaying another user's details (e.g. in transfers).
     */
    suspend fun getUserById(userId: String): Result<User> {
        return try {
            val doc = firestore
                .collection("users")
                .document(userId)
                .get()
                .await()

            val user = User.fromDocument(doc)
                ?: return Result.failure(Exception("User not found."))

            Result.success(user)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Returns the cached current user from SessionManager.
     * Zero Firestore reads — instant.
     */
    fun getCurrentUser(): User = User(
        id            = sessionManager.userId,
        name          = sessionManager.name,
        email         = sessionManager.email,
        role          = sessionManager.role,
        employeeId    = sessionManager.employeeId,
        assignedSites = sessionManager.assignedSites
    )

    /**
     * Fetches all users assigned to a specific site.
     * Used for transfer receiver suggestions.
     */
    suspend fun getUsersForSite(siteId: String): Result<List<User>> {
        return try {
            val snapshot = firestore
                .collection("users")
                .whereArrayContains("assignedSites", siteId)
                .get()
                .await()

            val users = snapshot.documents.mapNotNull { User.fromDocument(it) }
            Result.success(users)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}