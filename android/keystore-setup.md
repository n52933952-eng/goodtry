# Keystore Setup for PlaySocial Play Store Release

## Step 1: Generate Keystore

Run this command in the `android/app` directory:

```bash
cd android/app
keytool -genkeypair -v -storetype PKCS12 -keystore playsocial-release-key.keystore -alias playsocial-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

**IMPORTANT:** 
- Remember the passwords you enter (store password and key password)
- Keep the keystore file safe - you'll need it for all future updates
- Store passwords in a secure location
- The keystore file will be created in `android/app/playsocial-release-key.keystore`

## Step 2: Update gradle.properties

Add these lines to `android/gradle.properties`:

```
PLAYSOCIAL_RELEASE_STORE_FILE=playsocial-release-key.keystore
PLAYSOCIAL_RELEASE_KEY_ALIAS=playsocial-key-alias
PLAYSOCIAL_RELEASE_STORE_PASSWORD=your_store_password_here
PLAYSOCIAL_RELEASE_KEY_PASSWORD=your_key_password_here
```

**IMPORTANT:** 
- Replace `your_store_password_here` and `your_key_password_here` with your actual passwords
- The `gradle.properties` file is already in `.gitignore` to keep passwords secure

## Step 3: Build Release APK

```bash
cd android
./gradlew assembleRelease
```

The APK will be at: `android/app/build/outputs/apk/release/app-release.apk`

## Step 4: Build Release AAB (for Play Store - RECOMMENDED)

```bash
cd android
./gradlew bundleRelease
```

The AAB will be at: `android/app/build/outputs/bundle/release/app-release.aab`

**Note:** Google Play Store prefers AAB format over APK. Use AAB for Play Store uploads.

## Step 5: Verify the Build

Before uploading to Play Store, verify:
1. App name shows as "PlaySocial" on the device
2. Version code and version name are correct (currently 1 and 1.0.0)
3. The app is signed with your release keystore (not debug keystore)

## Troubleshooting

If you get "keystore file not found" error:
- Make sure the keystore file is in `android/app/` directory
- Check that `PLAYSOCIAL_RELEASE_STORE_FILE` in gradle.properties matches the filename

If you get password errors:
- Verify the passwords in `gradle.properties` match what you entered when creating the keystore
- Make sure there are no extra spaces or quotes in the passwords
