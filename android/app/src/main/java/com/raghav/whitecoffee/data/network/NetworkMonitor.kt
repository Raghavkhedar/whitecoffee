package com.raghav.whitecoffee.data.network

import kotlinx.coroutines.flow.Flow

/**
 * Connectivity status source.
 *
 * WHY THIS IS AN INTERFACE: the Android architecture guidance lists "network connectivity
 * status providers" among the data sources a ViewModel must not touch directly, and the
 * concrete implementation needs an `@ApplicationContext Context` to reach ConnectivityManager.
 * Ten of this app's ViewModels depend on this type, so while it was a concrete class *none of
 * them could be constructed on a JVM test runner* — building the ViewModel meant building a
 * Context. This seam is what makes those ViewModels unit-testable; see FakeNetworkMonitor in
 * the test sources.
 *
 * Deliberately one member: consumers only ever read [isOnline].
 */
interface NetworkMonitor {

    /**
     * Emits true when the device has an active validated internet connection, false otherwise.
     * Only emits when the state actually flips — no redundant updates.
     */
    val isOnline: Flow<Boolean>
}
