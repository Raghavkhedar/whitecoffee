package com.raghav.whitecoffee.data.repository

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

    /**
     * Fetches a single site by document ID.
     */
    suspend fun getSiteById(siteId: String): Result<Site> {
        return try {
            val doc = collection.document(siteId).get().await()
            val site = Site.fromDocument(doc)
                ?: return Result.failure(Exception("Site not found."))
            Result.success(site)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Fetches only the sites assigned to the current user.
     * Uses SessionManager cache — zero extra Firestore reads for the user doc.
     */
    suspend fun getAssignedSites(): Result<List<Site>> {
        return try {
            val assignedIds = sessionManager.assignedSites
            if (assignedIds.isEmpty()) return Result.success(emptyList())

            // Firestore whereIn supports max 30 items — safe for any realistic site list
            val snapshot = collection
                .whereIn(com.google.firebase.firestore.FieldPath.documentId(), assignedIds)
                .get()
                .await()

            val sites = snapshot.documents.mapNotNull { Site.fromDocument(it) }
            Result.success(sites)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Fetches all sites — used by office role users.
     */
    suspend fun getAllSites(): Result<List<Site>> {
        return try {
            val snapshot = collection.get().await()
            val sites = snapshot.documents.mapNotNull { Site.fromDocument(it) }
            Result.success(sites)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}