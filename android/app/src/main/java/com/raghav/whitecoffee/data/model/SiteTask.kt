package com.raghav.whitecoffee.data.model

/*
 * DAILY WORK INSTRUCTIONS FEATURE — NOT CURRENTLY IN USE
 *
 * SiteTask combined a Site's geofence data with per-day work instructions
 * (workDescription, toolsRequired) from the /daily_assignments Firestore collection.
 *
 * It was returned by SiteRepository.getTodayAssignedSites() and used as the
 * site model across AttendanceViewModel, MaterialToolRequestViewModel,
 * MaterialToolBuyViewModel, and WorkProgressViewModel.
 *
 * To re-enable: uncomment this class, uncomment getTodayAssignedSites() in
 * SiteRepository, and restore the site dropdown + daily_assignments reads
 * in all ViewModels and Fragments.
 *
 * data class SiteTask(
 *     val id: String = "",
 *     val name: String = "",
 *     val latitude: Double = 0.0,
 *     val longitude: Double = 0.0,
 *     val geofenceRadius: Double = 200.0,
 *     val workDescription: String = "",
 *     val toolsRequired: String = ""
 * )
 */
