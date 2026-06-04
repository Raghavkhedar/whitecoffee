package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.raghav.whitecoffee.data.model.Site
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SiteRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) {

    private val collection get() = firestore.collection("sites")

    suspend fun getSiteById(siteId: String): Result<Site> {
        return try {
            val doc = collection.document(siteId).get().await()
            val site = Site.fromDocument(doc) ?: return Result.failure(Exception("Site not found."))
            Result.success(site)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getAssignedSites(): Result<List<Site>> {
        return try {
            val assignedIds = sessionManager.assignedSites
            if (assignedIds.isEmpty()) return Result.success(emptyList())
            val snapshot = collection
                .whereIn(com.google.firebase.firestore.FieldPath.documentId(), assignedIds)
                .get()
                .await()
            Result.success(snapshot.documents.mapNotNull { Site.fromDocument(it) })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getAllSites(): Result<List<Site>> {
        return try {
            val snapshot = collection.get().await()
            Result.success(snapshot.documents.mapNotNull { Site.fromDocument(it) })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ── Admin operations ──────────────────────────────────────────────────

    suspend fun createSite(
        name: String,
        latitude: Double,
        longitude: Double,
        geofenceRadius: Double
    ): Result<String> {
        return try {
            val data = mapOf(
                "name"           to name.trim(),
                "latitude"       to latitude,
                "longitude"      to longitude,
                "geofenceRadius" to geofenceRadius,
                "assignedUserIds" to emptyList<String>(),
                "createdAt"      to Timestamp.now()
            )
            val ref = collection.add(data).await()
            Result.success(ref.id)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun updateSite(
        siteId: String,
        name: String,
        latitude: Double,
        longitude: Double,
        geofenceRadius: Double
    ): Result<Unit> {
        return try {
            collection.document(siteId).update(
                mapOf(
                    "name"           to name.trim(),
                    "latitude"       to latitude,
                    "longitude"      to longitude,
                    "geofenceRadius" to geofenceRadius
                )
            ).await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Atomically updates site's assignedUserIds AND each user's assignedSites list.
     * Uses batch writes so both sides stay in sync.
     */
    suspend fun assignUsersToSite(
        siteId: String,
        newUserIds: List<String>,
        previousUserIds: List<String>
    ): Result<Unit> {
        return try {
            val batch = firestore.batch()

            batch.update(
                collection.document(siteId),
                "assignedUserIds", newUserIds
            )

            val removed = previousUserIds.filter { it !in newUserIds }
            removed.forEach { uid ->
                batch.update(
                    firestore.collection("users").document(uid),
                    "assignedSites", FieldValue.arrayRemove(siteId)
                )
            }

            val added = newUserIds.filter { it !in previousUserIds }
            added.forEach { uid ->
                batch.update(
                    firestore.collection("users").document(uid),
                    "assignedSites", FieldValue.arrayUnion(siteId)
                )
            }

            batch.commit().await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
