package com.raghav.whitecoffee.di

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.storage.FirebaseStorage
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object FirebaseModule {

    /**
     * Provides a single FirebaseAuth instance for the entire app lifetime.
     * Injected into AuthRepository.
     */
    @Provides
    @Singleton
    fun provideFirebaseAuth(): FirebaseAuth = FirebaseAuth.getInstance()

    @Provides
    @Singleton
    fun provideFirebaseStorage(): FirebaseStorage = FirebaseStorage.getInstance()
    /**
     * Provides a single FirebaseFirestore instance for the entire app lifetime.
     * Offline persistence is already configured in WhiteCoffeeApp.onCreate().
     * Injected into all Repositories that touch Firestore.
     */
    @Provides
    @Singleton
    fun provideFirebaseFirestore(): FirebaseFirestore = FirebaseFirestore.getInstance()
}