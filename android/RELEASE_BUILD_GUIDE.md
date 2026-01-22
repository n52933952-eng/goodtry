# PlaySocial - Release Build Guide

## Quick Start

### 1. Generate Keystore (One-time setup)

```bash
cd android/app
keytool -genkeypair -v -storetype PKCS12 -keystore playsocial-release-key.keystore -alias playsocial-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

**You'll be asked for:**
- Keystore password (remember this!)
- Key password (can be same as keystore password)
- Your name, organization, city, state, country code

**IMPORTANT:** Save these passwords securely - you'll need them for all future updates!

### 2. Configure gradle.properties

Add these lines to `android/gradle.properties`:

```properties
PLAYSOCIAL_RELEASE_STORE_FILE=playsocial-release-key.keystore
PLAYSOCIAL_RELEASE_KEY_ALIAS=playsocial-key-alias
PLAYSOCIAL_RELEASE_STORE_PASSWORD=your_actual_store_password
PLAYSOCIAL_RELEASE_KEY_PASSWORD=your_actual_key_password
```

Replace `your_actual_store_password` and `your_actual_key_password` with the passwords you entered in step 1.

### 3. Build Release AAB (for Play Store)

```bash
cd android
./gradlew bundleRelease
```

The AAB file will be at: `android/app/build/outputs/bundle/release/app-release.aab`

### 4. Build Release APK (optional, for direct installation)

```bash
cd android
./gradlew assembleRelease
```

The APK file will be at: `android/app/build/outputs/apk/release/app-release.apk`

## Uploading to Play Store

1. Go to [Google Play Console](https://play.google.com/console)
2. Create a new app or select existing app
3. Go to "Production" → "Create new release"
4. Upload the AAB file (`app-release.aab`)
5. Fill in release notes
6. Review and publish

## Version Updates

When releasing updates, increment the version in `android/app/build.gradle`:

```gradle
versionCode 2  // Increment by 1 for each release
versionName "1.0.1"  // Update version number
```

## Troubleshooting

**Error: "keystore file not found"**
- Make sure `playsocial-release-key.keystore` is in `android/app/` directory
- Check that `PLAYSOCIAL_RELEASE_STORE_FILE` in gradle.properties matches the filename

**Error: "Password was incorrect"**
- Verify passwords in `gradle.properties` match what you entered when creating the keystore
- Make sure there are no extra spaces or quotes

**Error: "Keystore was tampered with"**
- Make sure you're using the correct keystore file
- Never share or lose your keystore file - you can't update the app on Play Store without it!

## Security Notes

- **NEVER commit** `playsocial-release-key.keystore` to git (already in .gitignore)
- **NEVER commit** `gradle.properties` with passwords (consider using environment variables)
- Keep a secure backup of your keystore file
- Store passwords in a password manager

## Current App Info

- **App Name:** PlaySocial
- **Package Name:** com.compnay
- **Version Code:** 1
- **Version Name:** 1.0.0
