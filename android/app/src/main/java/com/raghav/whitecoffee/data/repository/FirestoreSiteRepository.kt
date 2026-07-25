package com.raghav.whitecoffee.data.repository

import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.raghav.whitecoffee.data.firestore.AuditStamp
import com.raghav.whitecoffee.data.firestore.withAuditStamp
import com.raghav.whitecoffee.data.model.Site
// import com.google.firebase.firestore.FieldPath  // used by commented-out getTodayAssignedSites()
// import com.raghav.whitecoffee.data.model.SiteTask  // used by commented-out getTodayAssignedSites()
import com.raghav.whitecoffee.data.session.SessionManager
import kotlinx.coroutines.tasks.await
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SiteRepository @Inject constructor(
    private val firestore: FirebaseFirestore,
    private val sessionManager: SessionManager
) {

    private val collection get() = firestore.collection("sites")
    private val dateFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")

    suspend fun getSiteById(siteId: String): Result<Site> {
        return try {
            val doc = collection.document(siteId).get().await()
            val site = Site.fromDocument(doc) ?: return Result.failure(Exception("Site not found."))
            Result.success(site)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /*
     * DAILY ASSIGNMENT SYSTEM — NOT CURRENTLY IN USE
     *
     * getTodayAssignedSites() read /daily_assignments/{date}_{userId} from Firestore
     * and returned List<SiteTask> (site geofence data + work instructions for that day).
     *
     * The daily_assignments doc supported two formats:
     *   New: sites: [{siteId, workDescription, toolsRequired}]
     *   Old: siteIds: [String]  (backward-compat, no work details)
     *
     * All ViewModels (Attendance, MaterialToolRequest, MaterialToolBuy, WorkProgress)
     * called this instead of using a static assignedSiteIds field on the User.
     *
     * To re-enable: uncomment this method + SiteTask model + daily_assignments reads
     * in all ViewModels and Fragments.
     *
     * suspend fun getTodayAssignedSites(): Result<List<SiteTask>> {
     *     return try {
     *         val today = LocalDate.now().format(dateFormatter)
     *         val docId = "${today}_${sessionManager.userId}"
     *         val doc = firestore.collection("daily_assignments").document(docId).get().await()
     *         if (!doc.exists()) return Result.success(emptyList())
     *
     *         val workDetails = mutableMapOf<String, Pair<String, String>>()
     *         val siteIds: List<String>
     *         val sitesArray = doc.get("sites") as? List<*>
     *         if (sitesArray != null) {
     *             siteIds = sitesArray.filterIsInstance<Map<*, *>>().mapNotNull { map ->
     *                 val id = map["siteId"] as? String ?: return@mapNotNull null
     *                 workDetails[id] = Pair(
     *                     map["workDescription"] as? String ?: "",
     *                     map["toolsRequired"] as? String ?: ""
     *                 )
     *                 id
     *             }
     *         } else {
     *             siteIds = (doc.get("siteIds") as? List<*>)?.filterIsInstance<String>() ?: emptyList()
     *         }
     *         if (siteIds.isEmpty()) return Result.success(emptyList())
     *
     *         val snapshot = collection.whereIn(FieldPath.documentId(), siteIds).get().await()
     *         val tasks = snapshot.documents.mapNotNull { siteDoc ->
     *             val site = Site.fromDocument(siteDoc) ?: return@mapNotNull null
     *             val (work, tools) = workDetails[site.id] ?: Pair("", "")
     *             SiteTask(id = site.id, name = site.name, latitude = site.latitude,
     *                 longitude = site.longitude, geofenceRadius = site.geofenceRadius,
     *                 workDescription = work, toolsRequired = tools)
     *         }
     *         Result.success(tasks)
     *     } catch (e: Exception) {
     *         Result.failure(e)
     *     }
     * }
     */

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
                "createdAt"      to Timestamp.now()
            )
            // Stampable: /sites create is admin-only with no field-set restriction.
            val ref = collection.add(data.withAuditStamp(AuditStamp.uid(sessionManager))).await()
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
            // Stampable: /sites update is admin-only with no field-set restriction.
            collection.document(siteId).update(
                mapOf(
                    "name"           to name.trim(),
                    "latitude"       to latitude,
                    "longitude"      to longitude,
                    "geofenceRadius" to geofenceRadius
                ).withAuditStamp(AuditStamp.uid(sessionManager))
            ).await()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}
