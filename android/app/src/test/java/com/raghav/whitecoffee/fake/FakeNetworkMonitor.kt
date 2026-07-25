package com.raghav.whitecoffee.fake

import com.raghav.whitecoffee.data.network.NetworkMonitor
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * [NetworkMonitor] whose connectivity a test can flip at will.
 *
 * The real monitor registers a ConnectivityManager callback and needs a Context; ten
 * ViewModels depend on this type, so this three-line fake is what unblocks all of them.
 */
class FakeNetworkMonitor(online: Boolean = true) : NetworkMonitor {

    private val state = MutableStateFlow(online)

    override val isOnline: Flow<Boolean> = state

    fun setOnline(value: Boolean) { state.value = value }
}
