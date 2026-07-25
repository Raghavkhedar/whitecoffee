package com.raghav.whitecoffee.fake

import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.location.LocationState

/**
 * [LocationProvider] that hands back whatever the test asks for.
 *
 * The real provider needs a Context for its permission and GPS gates, which is what previously
 * made every attendance ViewModel impossible to unit-test.
 */
class FakeLocationProvider(
    var next: LocationState = LocationState.Success(28.6139, 77.2090)
) : LocationProvider {

    override var lastFixWasMock: Boolean = false
        private set

    /** How many times the subject asked for a fix — used to assert re-entrancy guards. */
    var calls: Int = 0
        private set

    var trackingStarted: Boolean = false
        private set

    var gpsEnabled: Boolean = true

    override suspend fun getCurrentLocation(): LocationState {
        calls++
        lastFixWasMock = (next as? LocationState.Success)?.isMock ?: false
        return next
    }

    override fun startTracking() { trackingStarted = true }

    override fun stopTracking() { trackingStarted = false }

    override fun isGpsEnabled(): Boolean = gpsEnabled
}
