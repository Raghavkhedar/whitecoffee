import com.google.firebase.appdistribution.gradle.firebaseAppDistribution
import java.io.FileInputStream
import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.compose.compiler) // Compose compiler plugin (Kotlin 2.0+)
    alias(libs.plugins.ksp)           // KSP must come before Hilt
    alias(libs.plugins.hilt)
    alias(libs.plugins.google.services)
    alias(libs.plugins.firebase.appdistribution) // Firebase App Distribution upload tasks
}

// Release signing — credentials live in the gitignored keystore.properties (never committed).
// If the file is absent (e.g. a fresh clone), release builds stay unsigned rather than failing config.
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) load(FileInputStream(keystorePropsFile))
}

android {
    namespace = "com.raghav.whitecoffee"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.raghav.whitecoffee"
        minSdk = 26
        targetSdk = 35
        versionCode = 8
        versionName = "1.8"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            if (keystorePropsFile.exists()) {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            // R8 code shrinking + obfuscation. Keep rules for Firestore models live
            // in proguard-rules.pro. Smoke-test a release build on-device before shipping.
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Sign with the dedicated release key when keystore.properties is present.
            if (keystorePropsFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
            // Firebase App Distribution. App ID comes from google-services.json.
            // Upload: ./gradlew assembleRelease appDistributionUploadRelease
            // Override notes per build: -PreleaseNotes="..."  (or pass --releaseNotes via CLI)
            firebaseAppDistribution {
                artifactType = "APK"
                groups = "employees"
                releaseNotes = (project.findProperty("releaseNotes") as String?) ?: "WhiteCoffee update"
            }
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
    // Compose enabled alongside Views — screens migrate one at a time via ComposeView interop.
    buildFeatures {
        viewBinding = true
        compose = true
    }
}

// AttendanceStatusRulesTest reads firebase/functions/attendance-rule-cases.txt — the case file
// shared with the Cloud Function's npm-test suite — so the app preview provably scores days the
// same way payroll does. Passed as an absolute path rather than resolved relatively, so the test
// doesn't silently depend on Gradle's working directory. rootProject here is `android/`; its
// parent is the monorepo root.
//
// inputs.file() is load-bearing, not decoration. The case file lives outside this module, so
// without declaring it Gradle sees no input change when a case is edited, reports the test task
// UP-TO-DATE, and never re-runs it — the shared cases would then silently stop guarding anything
// on the Kotlin side. Verified: with this line, editing a case re-runs the test and a mismatch
// fails the build; without it, the same edit passed in under a second.
tasks.withType<Test>().configureEach {
    val ruleCases = rootProject.projectDir.parentFile.resolve("firebase/functions/attendance-rule-cases.txt")
    systemProperty("repoRoot", rootProject.projectDir.parentFile.absolutePath)
    inputs.file(ruleCases).withPropertyName("attendanceRuleCases")
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
    implementation(libs.firebase.messaging)

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

    // ── Compose (Android-only; BoM keeps all Compose libs version-aligned) ──
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    debugImplementation(libs.compose.ui.tooling)

    // ── Location ──
    implementation(libs.play.services.location)

    // ── AndroidX UI ──
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.constraintlayout)
    implementation(libs.androidx.activity.ktx)
    implementation(libs.swiperefreshlayout)
    implementation(libs.work.runtime.ktx)
    implementation(libs.hilt.work)
    ksp(libs.hilt.work.compiler)

    // ── Testing ──
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    androidTestImplementation(libs.junit.ext)
    androidTestImplementation(libs.espresso.core)
}