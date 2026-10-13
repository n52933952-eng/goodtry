# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Release shrinking is on so Google Play's obfuscation score can clear 25%.
# Library rules (React Native, Firebase, WebRTC) come from those libraries.

# Keep crash line numbers. Play reads the mapping file inside the bundle.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Calls, notifications, and the React Native entry classes in this app.
-keep class com.playsocial.** { *; }

# Methods the JS bridge and native code call by name.
-keepclassmembers class * {
    native <methods>;
}
