# 🔍 Push Notification Troubleshooting Guide

## Current Setup Status:
✅ Notification channel created in `MainApplication.kt`
✅ Income library configured in `AndroidManifest.xml`
✅ FCM background handler in `index.js`
✅ Notification permissions in `AndroidManifest.xml`

## Key Difference from thredmobile:
- **thredmobile**: Uses native `MyFirebaseMessagingService.kt` (Android native code)
- **trueapp**: Uses JavaScript income library (`RNNotificationCall.displayNotification()`)

## Common Issues & Solutions:

### Issue 1: Notification Channel Not Created
**Symptom:** No sound, notification appears but silent

**Solution:** Rebuild the app - notification channel is created in `MainApplication.onCreate()`
```powershell
cd D:\trueapp\mobile\android
.\gradlew clean
cd ..\..
npx react-native run-android
```

### Issue 2: Android Notification Settings
**Check on device:**
1. Settings → Apps → Your App → Notifications
2. Look for "Incoming Calls" channel
3. Ensure:
   - Channel is **enabled**
   - Sound is **enabled**
   - Importance is **High** or **Max**
   - "Allow notification dot" is enabled

### Issue 3: Do Not Disturb (DND) Mode
**Check:**
- Settings → Do Not Disturb
- Ensure "Allow calls" is enabled
- The notification channel has `setBypassDnd(true)` but Android might override

### Issue 4: Income Library Not Showing Full-Screen UI
**If notification appears in drawer but not full-screen:**

Check Android logs:
```powershell
adb -s <DEVICE_ID> logcat | Select-String -Pattern "IncomingCall|FullScreenNotification|NotificationChannel"
```

### Issue 5: No Ringtone
**Possible causes:**
1. Device volume is off/muted
2. Notification channel sound is disabled in settings
3. Device is in silent/vibrate mode

**Fix:** Check device volume and notification channel settings

## Debug Steps:

### Step 1: Verify Notification Channel Exists
**After rebuilding, check:**
- Settings → Apps → Your App → Notifications → "Incoming Calls"
- Should show: "Importance: High", Sound enabled

### Step 2: Check Android Logs for Errors
```powershell
.\view-push-logs.ps1
```

Look for:
- `❌ [FCM] Error showing incoming call notification`
- `❌` any error related to notification display

### Step 3: Test with App in Background (Not Killed)
- Put app in background
- Make call from another device
- Does notification appear?
- If YES → issue is specific to killed app state
- If NO → issue is with income library setup

### Step 4: Check Device Notification Drawer
- Make call when app is killed
- Swipe down notification drawer
- Do you see ANY notification?
- If YES → notification is working but might not be full-screen
- If NO → notification isn't being displayed at all

## Expected Behavior:
1. App is killed
2. Call notification received via FCM
3. **Full-screen notification appears** with:
   - Caller name
   - Answer button (green)
   - Decline button (red)
   - Ringtone plays
   - Screen turns on (if locked)

## If Still Not Working:

### Check if income library is properly linked:
1. Rebuild app (ensures native module is linked)
2. Check Android logs for "FullScreenNotificationIncomingCall" errors

### Alternative: Test notification manually
Try calling `RNNotificationCall.displayNotification()` when app is running to see if it works at all.

## Quick Test Checklist:
- [ ] App rebuilt after adding notification channel code
- [ ] "Incoming Calls" channel visible in device settings
- [ ] Channel sound enabled in settings
- [ ] Device volume is on
- [ ] Test with app in background first
- [ ] Check Android logs for errors
- [ ] Notification appears in drawer (even if not full-screen)
