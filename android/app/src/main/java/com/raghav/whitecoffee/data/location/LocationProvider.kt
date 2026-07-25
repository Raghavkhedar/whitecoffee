package com.raghav.whitecoffee.data.location

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
 * Centralised location source for the entire app. All GPS logic lives behind this contract —
 * Fragments and ViewModels never touch FusedLocationProviderClient directly, and every edge
 * case is surfaced as a typed [LocationState].
 *
 * WHY THIS IS AN INTERFACE: the Android architecture guidance names "GPS location providers"
 * as a data source the UI layer must not depend on concretely, and the real implementation
 * needs an `@ApplicationContext Context` for the permission and GPS-enabled gates. While this
 * was a concrete class, no ViewModel that records attendance could be constructed in a JVM
 * unit test — which is precisely why the attendance state machines had no test coverage
 * despite being the highest-consequence logic in the app. See FakeLocationProvider.
 *
 * The surface is deliberately narrow: the live-tracking StateFlow stays an implementation
 * detail because nothing outside the provider reads it.
 */
interface LocationProvider {

    /**
     * Whether the most recent fix handed to a caller came from a mock location provider.
     *
     * Read by the attendance repository when writing a punch, so the server can flag it. It is
     * recorded, NEVER used to block a check-in: refusing a punch on a false positive would
     * cost a real employee a real day's pay, and the server-side verdict already surfaces it
     * for review.
     *
     * Read-only here on purpose — only the implementation that produced the fix may set it.
     */
    val lastFixWasMock: Boolean

    /**
     * Resolves a usable location for an attendance event, prioritising NOT blocking the
     * operator. Never throws — every outcome is a [LocationState].
     */
    suspend fun getCurrentLocation(): LocationState

    /**
     * Starts continuous foreground location tracking so attendance check-ins resolve instantly
     * instead of waiting on a fresh GPS fix. Idempotent and self-gating. Pair every call with
     * [stopTracking] when backgrounding so the sensor is never left running.
     */
    fun startTracking()

    /** Stops continuous tracking. Safe to call when not tracking. Leaves the last fix cached. */
    fun stopTracking()

    /** Whether the device's GPS provider is currently enabled. */
    fun isGpsEnabled(): Boolean
}
