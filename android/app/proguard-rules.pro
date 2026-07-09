# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Preserve line numbers for readable release crash traces, but hide the original
# source file name.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Firestore data models ────────────────────────────────────────────────
# These data classes are (de)serialized to/from Firestore. We map manually via
# fromDocument()/toMap(), but keep them + their members intact so any reflective
# path (and @DocumentId / @PropertyName annotations) survives R8 shrinking.
-keep class com.raghav.whitecoffee.data.model.** { *; }
-keepclassmembers class com.raghav.whitecoffee.data.model.** {
    <init>(...);
    <fields>;
}

# Firebase Firestore custom-object annotations.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-keepnames class com.google.firebase.firestore.** { *; }

# Kotlin coroutines internals occasionally accessed reflectively.
-keepnames class kotlinx.coroutines.** { *; }