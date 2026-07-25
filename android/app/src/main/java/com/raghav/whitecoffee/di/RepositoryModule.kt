package com.raghav.whitecoffee.di

import com.raghav.whitecoffee.data.repository.AttendanceRepository
import com.raghav.whitecoffee.data.repository.AuthRepository
import com.raghav.whitecoffee.data.repository.FirebaseAuthRepository
import com.raghav.whitecoffee.data.repository.FirestoreAttendanceRepository
import com.raghav.whitecoffee.data.repository.FirestoreLeaveRepository
import com.raghav.whitecoffee.data.repository.FirestoreNotificationRepository
import com.raghav.whitecoffee.data.repository.FirestoreRegularizationRepository
import com.raghav.whitecoffee.data.repository.FirestoreRequestRepository
import com.raghav.whitecoffee.data.repository.FirestoreSiteRepository
import com.raghav.whitecoffee.data.repository.FirestoreUserRepository
import com.raghav.whitecoffee.data.repository.LeaveRepository
import com.raghav.whitecoffee.data.repository.NotificationRepository
import com.raghav.whitecoffee.data.repository.RegularizationRepository
import com.raghav.whitecoffee.data.repository.RequestRepository
import com.raghav.whitecoffee.data.repository.SiteRepository
import com.raghav.whitecoffee.data.repository.UserRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Binds repository contracts to their production implementations.
 *
 * Repositories are the app's business-logic layer; ViewModels depend on the interface, never
 * the implementation, so every one of them can be unit-tested against a fake. This module is
 * the single place that decides which concrete type answers each contract — a test can replace
 * the whole module rather than touching any consumer.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindAttendanceRepository(
        impl: FirestoreAttendanceRepository
    ): AttendanceRepository

    @Binds
    @Singleton
    abstract fun bindAuthRepository(impl: FirebaseAuthRepository): AuthRepository

    @Binds
    @Singleton
    abstract fun bindLeaveRepository(impl: FirestoreLeaveRepository): LeaveRepository

    @Binds
    @Singleton
    abstract fun bindNotificationRepository(
        impl: FirestoreNotificationRepository
    ): NotificationRepository

    @Binds
    @Singleton
    abstract fun bindRegularizationRepository(
        impl: FirestoreRegularizationRepository
    ): RegularizationRepository

    @Binds
    @Singleton
    abstract fun bindRequestRepository(impl: FirestoreRequestRepository): RequestRepository

    @Binds
    @Singleton
    abstract fun bindSiteRepository(impl: FirestoreSiteRepository): SiteRepository

    @Binds
    @Singleton
    abstract fun bindUserRepository(impl: FirestoreUserRepository): UserRepository
}
