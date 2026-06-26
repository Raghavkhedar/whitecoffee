package com.raghav.whitecoffee.data.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
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
import kotlinx.coroutines.tasks.await
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
        private const val LOCATION_TIMEOUT_MS = 15_000L          // 15s for a fresh fix (was 10s)
        private const val FAST_PATH_ACCURACY_METERS = 100f       // accept a cached fix this good outright
        private const val FAST_PATH_MAX_AGE_MS = 2 * 60 * 1000L  // ...if no older than 2 minutes
    }

    /**
     * Resolves a usable location for an attendance event, prioritising NOT blocking the operator.
     *
     * Strategy (in order):
     * 1. Permission + GPS-enabled gates (hard failures — operator must fix these).
     * 2. Fast path — a recent, reasonably accurate last-known fix is returned instantly. This is
     *    what stops the check-in spinner from hanging on a cold GPS start in the field.
     * 3. Fresh single fix within the timeout window.
     * 4. Final fallback — ANY last-known fix, even stale/coarse, rather than failing the check-in.
     *    For attendance the device-clock timestamp is what matters; there is no geofencing, so an
     *    approximate location beats blocking the operator. Only a total absence of any fix returns
     *    Timeout.
     *
     * Suspend function — call from a coroutine scope (ViewModel).
     */
    @SuppressLint("MissingPermission") // permission verified by hasLocationPermission() gate below
    suspend fun getCurrentLocation(): LocationState {

        // Gate 1 — Permission check
        if (!hasLocationPermission()) {
            return LocationState.PermissionDenied
        }

        // Gate 2 — GPS enabled check
        if (!isGpsEnabled()) {
            return LocationState.GpsDisabled
        }

        // Gate 3 — Fast path: a recent, decent cached fix avoids any spinner at all.
        val cached = lastKnownLocation()
        if (cached != null &&
            cached.accuracy <= FAST_PATH_ACCURACY_METERS &&
            System.currentTimeMillis() - cached.time <= FAST_PATH_MAX_AGE_MS
        ) {
            return LocationState.Success(cached.latitude, cached.longitude)
        }

        // Gate 4 — Try for a fresh fix.
        val fresh = withTimeoutOrNull(LOCATION_TIMEOUT_MS) { requestSingleLocationFix() }
        if (fresh is LocationState.Success) {
            return fresh
        }

        // Gate 5 — Fresh fix failed/timed out: fall back to any last-known fix rather than blocking.
        val fallback = cached ?: lastKnownLocation()
        if (fallback != null) {
            return LocationState.Success(fallback.latitude, fallback.longitude)
        }

        return LocationState.Timeout
    }

    /** Instant cached fix from the fused provider. Null on error or if none is available yet. */
    @SuppressLint("MissingPermission") // callers gate on hasLocationPermission()
    private suspend fun lastKnownLocation(): Location? =
        try {
            fusedLocationClient.lastLocation.await()
        } catch (e: Exception) {
            null
        }

    @SuppressLint("MissingPermission") // callers gate on hasLocationPermission()
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

                    // Any fresh fix is accepted — accuracy is no longer a hard gate. Coarse GPS in
                    // the field should never block a check-in (the caller also has a cached fallback).
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

    fun isGpsEnabled(): Boolean {
        val locationManager =
            context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
    }
}