package com.raghav.whitecoffee.data.model

data class SiteTask(
    val id: String = "",
    val name: String = "",
    val latitude: Double = 0.0,
    val longitude: Double = 0.0,
    val geofenceRadius: Double = 200.0,
    val workDescription: String = "",
    val toolsRequired: String = ""
)
