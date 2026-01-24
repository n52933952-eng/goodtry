# 🛠️ Build Instructions - Speaker Toggle Feature

## Important: Native Module Rebuild Required

The speaker toggle feature uses **react-native-incall-manager**, which is a native module. You **MUST rebuild the app** for the feature to work.

---

## 🚀 Quick Start

### For Android
```bash
cd mobile

# Clean build (recommended)
cd android
./gradlew clean
cd ..

# Rebuild and run
npm run android
```

### For iOS
```bash
cd mobile

# Install pods
cd ios
bundle exec pod install
cd ..

# Rebuild and run
npm run ios
```

---

## 📋 Detailed Steps

### Android

#### Option 1: Clean Rebuild (Recommended)
```bash
# 1. Navigate to mobile folder
cd mobile

# 2. Clean previous builds
cd android
./gradlew clean
cd ..

# 3. Clear metro cache
npm start -- --reset-cache

# 4. In a new terminal, run
npm run android
```

#### Option 2: Quick Rebuild
```bash
cd mobile
npm run android
```

#### Option 3: Manual Build
```bash
cd mobile/android
./gradlew assembleDebug
cd ..
npx react-native run-android
```

---

### iOS

#### Option 1: Full Rebuild (Recommended)
```bash
# 1. Navigate to mobile folder
cd mobile

# 2. Install/update CocoaPods dependencies
cd ios
bundle install  # First time only
bundle exec pod install
cd ..

# 3. Clean build folder (optional but recommended)
cd ios
xcodebuild clean
cd ..

# 4. Run app
npm run ios
```

#### Option 2: Quick Rebuild
```bash
cd mobile
cd ios
pod install
cd ..
npm run ios
```

---

## ⚠️ Common Issues & Solutions

### Issue 1: "InCallManager is not defined"
**Cause:** Native module not linked
**Solution:**
```bash
# Android
cd android
./gradlew clean
cd ..
npm run android

# iOS
cd ios
pod install
cd ..
npm run ios
```

### Issue 2: Build fails with "duplicate symbols"
**Cause:** Conflicting dependencies
**Solution:**
```bash
# Clean everything
rm -rf node_modules
rm -rf android/build
rm -rf ios/build
rm -rf ios/Pods

# Reinstall
npm install

# iOS: Reinstall pods
cd ios
pod install
cd ..

# Rebuild
npm run android  # or npm run ios
```

### Issue 3: Speaker button doesn't work
**Cause:** App not rebuilt after changes
**Solution:**
```bash
# Force a clean rebuild
cd mobile
npm run android -- --reset-cache

# Or for iOS
npm run ios -- --reset-cache
```

### Issue 4: "Cannot read property 'start' of undefined"
**Cause:** InCallManager module not found
**Solution:**
```bash
# Verify installation
cd mobile
npm list react-native-incall-manager

# If not found, reinstall
npm install react-native-incall-manager

# Then rebuild
npm run android  # or npm run ios
```

---

## 🧪 Verification Steps

After rebuilding, verify the feature works:

1. **Launch App**
   ```bash
   npm run android  # or npm run ios
   ```

2. **Test Video Call**
   - Start a video call
   - Check if speaker button appears (between mute and camera)
   - Button should show 🔊 with blue background (speaker ON by default)
   - Tap button → Should show 📱 (earpiece mode)

3. **Test Audio Call**
   - Start an audio call
   - Button should show 📱 (earpiece by default)
   - Tap button → Should show 🔊 with blue background (speaker ON)

4. **Check Console Logs**
   ```
   ✅ Look for these logs:
   📞 [WebRTC] InCallManager started
   📢 [WebRTC] Speaker ON
   📱 [WebRTC] Earpiece ON
   📞 [WebRTC] InCallManager stopped
   ```

---

## 📱 Platform-Specific Notes

### Android
- Requires gradle sync after clean
- May take 5-10 minutes for first build
- Emulator must support audio (AVD config)
- Physical device recommended for testing

### iOS
- Requires Xcode installed
- Pod install may take 2-5 minutes
- Simulator supports audio testing
- Physical device recommended for full testing

---

## 🎯 Build Success Indicators

You'll know the build succeeded when:

✅ No build errors in console
✅ App launches successfully
✅ Speaker button appears in call screen
✅ Button responds to taps
✅ Audio switches between speaker/earpiece
✅ Console shows InCallManager logs

---

## 📞 Support

If you encounter issues:

1. **Check Logs**
   ```bash
   # Android
   adb logcat | grep -i "InCallManager"
   
   # iOS
   # Check Xcode console
   ```

2. **Verify Module**
   ```bash
   cd mobile
   npm list react-native-incall-manager
   # Should show: react-native-incall-manager@4.2.1
   ```

3. **Clean Everything**
   ```bash
   # Nuclear option - clean everything and rebuild
   cd mobile
   rm -rf node_modules android/build ios/build ios/Pods
   npm install
   cd ios && pod install && cd ..
   npm run android  # or npm run ios
   ```

---

## ✅ Quick Reference

### Minimum Steps (Android)
```bash
cd mobile
npm run android
```

### Minimum Steps (iOS)
```bash
cd mobile
cd ios && pod install && cd ..
npm run ios
```

### Full Clean Rebuild (Android)
```bash
cd mobile
cd android && ./gradlew clean && cd ..
npm run android -- --reset-cache
```

### Full Clean Rebuild (iOS)
```bash
cd mobile
cd ios && pod install && cd ..
npm run ios -- --reset-cache
```

---

## 🎉 Ready to Test!

Once rebuild is complete, the speaker toggle feature will be fully functional! Happy calling! 📞🔊
