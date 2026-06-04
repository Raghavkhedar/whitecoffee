plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.ksp)           // KSP must come before Hilt
    alias(libs.plugins.hilt)
    alias(libs.plugins.google.services)
}

android {
    namespace = "com.raghav.whitecoffee"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.raghav.whitecoffee"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"

        freeCompilerArgs += listOf("-Xskip-metadata-version-check")
    }

    // Enable ViewBinding — required for BaseFragment pattern
    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    // Photo Upload
    implementation(libs.glide)
    // ── Hilt ──
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.fragment)

    // ── Firebase ──
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    implementation(libs.firebase.firestore)
    implementation(libs.firebase.analytics)
    implementation(libs.firebase.storage)

    // ── Coroutines ──
    implementation(libs.coroutines.android)

    // ── Lifecycle ──
    implementation(libs.lifecycle.viewmodel.ktx)
    implementation(libs.lifecycle.runtime.ktx)

    // ── Navigation ──
    implementation(libs.navigation.fragment.ktx)
    implementation(libs.navigation.ui.ktx)

    // ── Fragment ──
    implementation(libs.fragment.ktx)

    // ── Location ──
    implementation(libs.play.services.location)

    // ── AndroidX UI ──
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.constraintlayout)
    implementation(libs.androidx.activity.ktx)

    // ── Testing ──
    testImplementation(libs.junit)
    androidTestImplementation(libs.junit.ext)
    androidTestImplementation(libs.espresso.core)
}