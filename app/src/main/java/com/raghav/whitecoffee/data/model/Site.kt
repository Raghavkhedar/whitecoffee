package com.raghav.whitecoffee.data.model

import com.google.firebase.firestore.DocumentId
import com.google.firebase.firestore.DocumentSnapshot

data class Site(
    @DocumentId
    val id: String = "",
    val name: String = "",
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val geofenceRadius: Double = 200.0
) {
    companion object {
        fun fromDocument(doc: DocumentSnapshot): Site? {
            return try {
                Site(
                    id              = doc.id,
                    name            = doc.getString("name") ?: return null,
                    latitude        = doc.getDouble("latitude") ?: return null,
                    longitude       = doc.getDouble("longitude") ?: return null,
                    geofenceRadius  = doc.getDouble("geofenceRadius") ?: 200.0
                )
            } catch (e: Exception) {
                null
            }
        }
    }
}
