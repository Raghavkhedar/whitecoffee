package com.raghav.whitecoffee.data.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.Priority
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
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
    /**
     * @param isMock the fix came from a mock location provider. Reported, never used to
     *   block a check-in — the punch is recorded and flagged server-side for review, so a
     *   false positive can never cost someone a day's pay.
     */
    data class Success(
        val latitude: Double,
        val longitude: Double,
        val isMock: Boolean = false,
    ) : LocationState
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

        // Continuous foreground tracking — keeps a warm fix ready so attendance taps don't wait
        // on GPS. Balanced power (wifi/cell + occasional GPS) is plenty: there is no geofencing,
        // so an approximate fix is fine and the battery cost stays low.
        private const val TRACKING_INTERVAL_MS = 10_000L         // desired refresh cadence
        private const val TRACKING_FASTEST_MS = 5_000L           // accept faster updates if available
        private const val LIVE_FIX_MAX_AGE_MS = 30_000L          // a tracked fix this fresh is used instantly
    }

    // Latest fix from the continuous foreground tracker (null until the first update arrives).
    // Exposed as a flow so callers could observe it, but getCurrentLocation() also reads it directly.
    /**
     * Whether the most recent fix handed to a caller came from a mock location provider.
     *
     * Read by AttendanceRepository when writing a punch, so the server can flag it. It is
     * recorded, NEVER used to block a check-in: refusing a punch on a false positive would
     * cost a real employee a real day's pay, and the server-side verdict already surfaces
     * it for review.
     */
    @Volatile
    var lastFixWasMock: Boolean = false
        private set

    /** Record the fix's mock status, then wrap it as a Success. */
    private fun succeed(location: Location): LocationState.Success {
        val mock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            location.isMock
        } else {
            @Suppress("DEPRECATION")
            location.isFromMockProvider
        }
        lastFixWasMock = mock
        return LocationState.Success(location.latitude, location.longitude, mock)
    }

    private val _liveLocation = MutableStateFlow<Location?>(null)
    val liveLocation: StateFlow<Location?> = _liveLocation.asStateFlow()

    private var trackingCallback: LocationCallback? = null

    /**
     * Resolves a usable location for an attendance event, prioritising NOT blocking the operator.
     *
     * Strategy (in order):
     * 1. Permission + GPS-enabled gates (hard failures — operator must fix these).
     * 2. Live tracked fix — the warm fix kept fresh by [startTracking] while the app is
     *    foregrounded. This is the zero-wait path for a snappy check-in.
     * 3. Fast path — a recent, reasonably accurate last-known fix is returned instantly. This is
     *    what stops the check-in spinner from hanging on a cold GPS start in the field.
     * 4. Fresh single fix within the timeout window.
     * 5. Final fallback — ANY last-known fix, even stale/coarse, rather than failing the check-in.
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

        // Gate 3 — Live tracked fix: if the foreground tracker has a recent fix, return it instantly.
        // This is the zero-wait path that makes attendance taps feel snappy.
        val live = _liveLocation.value
        if (live != null && System.currentTimeMillis() - live.time <= LIVE_FIX_MAX_AGE_MS) {
            return succeed(live)
        }

        // Gate 4 — Fast path: a recent, decent cached fix avoids any spinner at all.
        val cached = lastKnownLocation()
        if (cached != null &&
            cached.accuracy <= FAST_PATH_ACCURACY_METERS &&
            System.currentTimeMillis() - cached.time <= FAST_PATH_MAX_AGE_MS
        ) {
            return succeed(cached)
        }

        // Gate 5 — Try for a fresh fix.
        val fresh = withTimeoutOrNull(LOCATION_TIMEOUT_MS) { requestSingleLocationFix() }
        if (fresh is LocationState.Success) {
            return fresh
        }

        // Gate 6 — Fresh fix failed/timed out: fall back to any last-known fix rather than blocking.
        val fallback = cached ?: lastKnownLocation()
        if (fallback != null) {
            return succeed(fallback)
        }

        return LocationState.Timeout
    }

    /**
     * Starts continuous foreground location tracking. Keeps [_liveLocation] warm so attendance
     * check-ins resolve instantly instead of waiting on a fresh GPS fix.
     *
     * Idempotent and self-gating: no-ops if a tracker is already running, if location permission
     * is not granted, or if GPS is disabled. Call from the app's foreground lifecycle (e.g.
     * MainActivity.onStart) and pair every start with [stopTracking] when backgrounding so the
     * sensor is never left running in the background.
     */
    @SuppressLint("MissingPermission") // gated by hasLocationPermission() below
    fun startTracking() {
        if (trackingCallback != null) return
        if (!hasLocationPermission() || !isGpsEnabled()) return

        // Seed immediately with the last-known fix so a value is ready before the first interval.
        fusedLocationClient.lastLocation.addOnSuccessListener { loc ->
            if (loc != null && _liveLocation.value == null) _liveLocation.value = loc
        }

        val request = LocationRequest.Builder(
            Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            TRACKING_INTERVAL_MS
        )
            .setMinUpdateIntervalMillis(TRACKING_FASTEST_MS)
            .build()

        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { _liveLocation.value = it }
            }
        }
        trackingCallback = callback
        fusedLocationClient.requestLocationUpdates(request, callback, Looper.getMainLooper())
    }

    /** Stops continuous tracking. Safe to call when not tracking. Leaves the last fix cached. */
    fun stopTracking() {
        trackingCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        trackingCallback = null
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
                        continuation.resume(succeed(location))
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