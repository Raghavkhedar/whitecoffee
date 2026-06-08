package com.raghav.whitecoffee

import android.app.Application
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreSettings
import com.google.firebase.firestore.PersistentCacheSettings
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class WhiteCoffeeApp : Application() {

    override fun onCreate() {
        super.onCreate()
        configureFirestore()
    }

    private fun configureFirestore() {
        val settings = FirebaseFirestoreSettings.Builder()
            .setLocalCacheSettings(
                PersistentCacheSettings.newBuilder()
                    .setSizeBytes(50L * 1024 * 1024)
                    .build()
            )
            .build()
        FirebaseFirestore.getInstance().firestoreSettings = settings
    }
}