// Top-level build file — plugin declarations only. No repos here (settings.gradle.kts handles that).
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android)      apply false
    alias(libs.plugins.compose.compiler)    apply false
    alias(libs.plugins.ksp)                 apply false
    alias(libs.plugins.hilt)                apply false
    alias(libs.plugins.google.services)     apply false
    alias(libs.plugins.firebase.appdistribution) apply false
}