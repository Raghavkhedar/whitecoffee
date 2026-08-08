package com.raghav.whitecoffee.di

import com.raghav.whitecoffee.data.location.FusedLocationProvider
import com.raghav.whitecoffee.data.location.LocationProvider
import com.raghav.whitecoffee.data.network.ConnectivityNetworkMonitor
import com.raghav.whitecoffee.data.network.NetworkMonitor
import com.raghav.whitecoffee.data.notification.AttendanceNotifier
import com.raghav.whitecoffee.data.notification.SystemAttendanceNotifier
import com.raghav.whitecoffee.data.photo.PhotoPipeline
import com.raghav.whitecoffee.data.photo.WorkManagerPhotoPipeline
import com.raghav.whitecoffee.data.session.PrefsSessionManager
import com.raghav.whitecoffee.data.session.SessionManager
import com.raghav.whitecoffee.data.time.Clock
import com.raghav.whitecoffee.data.time.SystemClock
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Binds device data sources to their platform-backed implementations.
 *
 * These are @Binds, not @Provides: Hilt already knows how to construct each implementation
 * from its @Inject constructor, so this module only has to say which concrete type satisfies
 * each contract. Swapping in a fake for a test is then a one-line module replacement rather
 * than a change to any consumer.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class DataSourceModule {

    @Binds
    @Singleton
    abstract fun bindLocationProvider(impl: FusedLocationProvider): LocationProvider

    @Binds
    @Singleton
    abstract fun bindNetworkMonitor(impl: ConnectivityNetworkMonitor): NetworkMonitor

    @Binds
    @Singleton
    abstract fun bindSessionManager(impl: PrefsSessionManager): SessionManager

    @Binds
    @Singleton
    abstract fun bindPhotoPipeline(impl: WorkManagerPhotoPipeline): PhotoPipeline

    /**
     * "What day is it" is a data source too — and one that decides pay. Behind a contract so a
     * test can walk the app over midnight; see [Clock].
     */
    @Binds
    @Singleton
    abstract fun bindClock(impl: SystemClock): Clock

    @Binds
    @Singleton
    abstract fun bindAttendanceNotifier(impl: SystemAttendanceNotifier): AttendanceNotifier
}
