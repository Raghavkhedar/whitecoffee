package com.raghav.whitecoffee.data.repository

import com.raghav.whitecoffee.data.model.Site

/**
 * Site records. Readable by every signed-in user; writes are admin-only in the portal.
 *
 * Note the stored coordinates and geofence radius are **recorded, never enforced** — there is
 * no geofencing at check-in anywhere in the app.
 *
 * Implemented by [FirestoreSiteRepository] in production, faked in tests.
 */
interface SiteRepository {

    suspend fun getSiteById(siteId: String): Result<Site>

    suspend fun getAllSites(): Result<List<Site>>

    suspend fun createSite(
        name: String,
        latitude: Double,
        longitude: Double,
        geofenceRadius: Double
    ): Result<String>

    suspend fun updateSite(
        siteId: String,
        name: String,
        latitude: Double,
        longitude: Double,
        geofenceRadius: Double
    ): Result<Unit>
}
