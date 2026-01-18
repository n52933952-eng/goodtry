# 🔍 Push Notification Debugging Guide

## Quick Check Commands

### 1. View FCM Logs
```powershell
.\view-fcm-logs.ps1
```

### 2. View All Push Logs (Device 1)
```powershell
.\view-push-logs.ps1
```

### 3. Clear Logs
```powershell
.\clear-logs.ps1
```

## What to Look For in Logs

### ✅ Success Indicators:
- `🔥 [FCM] ========== MESSAGE RECEIVED ==========`
- `📞 [FCM] Incoming call notification received`
- `🔥 [FCM] ========== SHOWING INCOMING CALL ==========`
- `✅ [FCM] Income library IncomingCallService started`
- `FullscreenService: displayNotification ui`

### ❌ Error Indicators:
- `❌ [FCM] Error showing incoming call notification`
- `❌ [FCM] React Native context is null`
- `No Firebase App '[DEFAULT]' has been created`
- `ClassNotFoundException: MyFirebaseMessagingService`
- `Service not found`

## Common Issues & Solutions

### Issue 1: Service Not Found
**Symptom:** `ClassNotFoundException: MyFirebaseMessagingService`

**Solution:**
1. Rebuild the app (native code changes require rebuild):
   ```powershell
   cd android
   .\gradlew clean
   cd ..
   npx react-native run-android
   ```

### Issue 2: FCM Message Not Received
**Symptom:** No `🔥 [FCM] MESSAGE RECEIVED` in logs

**Check:**
1. Is FCM token registered? Check backend logs
2. Is backend sending notification with correct format?
3. Check device notification settings:
   - Settings → Apps → Your App → Notifications
   - Ensure "Incoming Calls" channel is enabled

### Issue 3: Income Library Not Starting
**Symptom:** `✅ [FCM] Income library IncomingCallService started` but no UI

**Check:**
1. Notification channel exists:
   - Settings → Apps → Your App → Notifications → "Incoming Calls"
   - Should show: "Importance: High"
2. Device volume is on
3. Do Not Disturb is off (or allows calls)

### Issue 4: JavaScript Background Handler Interfering
**Symptom:** Both native service and JS handler trying to show notification

**Note:** This is OK - both will try, but only one will succeed. The native service should work when app is killed.

## Testing Steps

### Test 1: App Running (Foreground)
1. Keep app open
2. Make call from another device
3. Should see regular CallScreen (NOT income library)

### Test 2: App in Background
1. Press home button (app in background)
2. Make call from another device
3. Should see income library notification

### Test 3: App Killed
1. Swipe away app from recent apps
2. Make call from another device
3. Should see income library notification

## Backend FCM Message Format

The backend should send FCM with this data format:
```json
{
  "data": {
    "type": "incoming_call",
    "callerId": "user_id_here",
    "callerName": "User Name",
    "callType": "audio" // or "video"
  }
}
```

## Verification Checklist

- [ ] App rebuilt after adding MyFirebaseMessagingService.kt
- [ ] MyFirebaseMessagingService registered in AndroidManifest.xml
- [ ] Income library activities registered in AndroidManifest.xml
- [ ] FCM token saved to backend
- [ ] Backend sending FCM with correct format
- [ ] Device notification permissions granted
- [ ] "Incoming Calls" notification channel exists
- [ ] Device volume is on
- [ ] Do Not Disturb allows calls
