package com.raghav.whitecoffee.data.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.Priority
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * Sealed result type for every location request.
 * Named LocationState to avoid clash with GMS LocationResult.
 * Forces every caller to handle all possible outcomes —
 * no silent failures, no crashes on edge cases.
 */
sealed interface LocationState {
    data class Success(val latitude: Double, val longitude: Double) : LocationState
    data object GpsDisabled : LocationState
    data object PermissionDenied : LocationState
    data object LowAccuracy : LocationState
    data object Timeout : LocationState
}

/**
 * Centralised location provider for the entire app.
 *
 * All GPS logic lives here — Fragments and ViewModels never touch
 * FusedLocationProviderClient directly. Every edge case is handled
 * and surfaced as a typed LocationState.
 */
@Singleton
class LocationProvider @Inject constructor(
    @ApplicationContext private val context: Context,
    private val fusedLocationClient: FusedLocationProviderClient
) {

    companion object {
        private const val LOCATION_TIMEOUT_MS = 10_000L  // 10 seconds
        private const val MIN_ACCURACY_METERS = 50f       // 50m threshold
    }

    /**
     * Requests a single high-accuracy location fix.
     *
     * Checks in order:
     * 1. Fine location permission granted
     * 2. GPS provider enabled on device
     * 3. Location accuracy within acceptable threshold
     * 4. Times out after 10 seconds if no fix received
     *
     * Suspend function — call from a coroutine scope (ViewModel).
     */
    suspend fun getCurrentLocation(): LocationState {

        // Gate 1 — Permission check
        if (!hasLocationPermission()) {
            return LocationState.PermissionDenied
        }

        // Gate 2 — GPS enabled check
        if (!isGpsEnabled()) {
            return LocationState.GpsDisabled
        }

        // Gate 3 — Request location with timeout
        return withTimeoutOrNull(LOCATION_TIMEOUT_MS) {
            requestSingleLocationFix()
        } ?: LocationState.Timeout
    }

    private suspend fun requestSingleLocationFix(): LocationState =
        suspendCancellableCoroutine { continuation ->

            val locationRequest = LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                5000L
            )
                .setMaxUpdates(1)
                .setMinUpdateDistanceMeters(0f)
                .build()

            val callback = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    fusedLocationClient.removeLocationUpdates(this)

                    val location = result.lastLocation
                    if (location == null) {
                        if (continuation.isActive) {
                            continuation.resume(LocationState.Timeout)
                        }
                        return
                    }

                    // Gate 3 — Accuracy validation
                    if (location.accuracy > MIN_ACCURACY_METERS) {
                        if (continuation.isActive) {
                            continuation.resume(LocationState.LowAccuracy)
                        }
                        return
                    }

                    if (continuation.isActive) {
                        continuation.resume(
                            LocationState.Success(
                                latitude = location.latitude,
                                longitude = location.longitude
                            )
                        )
                    }
                }
            }

            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                callback,
                Looper.getMainLooper()
            )

            // Clean up if coroutine is cancelled (e.g. user navigates away)
            continuation.invokeOnCancellation {
                fusedLocationClient.removeLocationUpdates(callback)
            }
        }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

    private fun isGpsEnabled(): Boolean {
        val locationManager =
            context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
    }
}