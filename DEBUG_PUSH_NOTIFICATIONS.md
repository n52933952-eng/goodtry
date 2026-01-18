# 🔍 Debug Push Notifications

## Issue: Push notifications not working when app is killed

### Possible Causes:

1. **Backend only sends notifications when user is OFFLINE**
   - Check backend logs to see if notification is being sent
   - User must be marked as offline (no active socket connection)

2. **FCM token not saved correctly**
   - Check if token is in database for the receiver user

3. **Background message handler not working**
   - Check if `index.js` background handler is receiving messages

## Step-by-Step Debugging:

### 1. Check Backend Logs

**On the backend server terminal, look for:**
```
📱 [callUser] User [USER_ID] is OFFLINE, sending push notification
📤 [callUser] Calling sendCallNotification(...)
🔥 [FCM] sendCallNotification called
🔥 [FCM] Sending call notification...
✅ [FCM] Notification sent successfully
```

**If you see these logs, backend IS sending the notification.**

**If you DON'T see "OFFLINE" message:**
- The user is still considered ONLINE (socket connected)
- Wait 5-10 seconds after killing the app for socket to disconnect
- Or check if socket disconnection is properly handled

### 2. Check Mobile App Logs (Receiver Device)

**In your push logs terminal, look for:**
```
🔥 [FCM] Background message received
📞 [FCM] Incoming call in background/killed state
📞 [FCM] Showing incoming call notification...
✅ [FCM] Incoming call notification displayed
```

**If you DON'T see these logs:**
- The notification is not reaching the device
- Check FCM token is correct
- Check backend FCM service account is configured

### 3. Verify User is Marked Offline

**Test sequence:**
1. User 1 (Receiver): Login → Kill app → Wait 10 seconds
2. User 2 (Caller): Make call

**Check backend logs:**
- Should see "User [ID] is OFFLINE"
- Should see "sending push notification"

### 4. Check FCM Token in Database

**Verify the receiver's FCM token is saved:**
```javascript
// In backend, check if user has fcmToken
User.findById(userId).select('fcmToken')
```

### 5. Test Foreground First

**Before testing killed app:**
1. Put app in background (don't kill)
2. Make call from other device
3. Check if notification appears

**If foreground works but killed doesn't:**
- Issue is likely with background message handler
- Check `index.js` background handler setup

## Quick Test:

### Terminal 1 - Backend Logs:
```
# Watch for notification sending
[Should see] 📱 [callUser] User [ID] is OFFLINE
[Should see] 🔥 [FCM] Sending call notification...
```

### Terminal 2 - Device 1 Logs (Receiver):
```
.\view-push-logs.ps1
[Should see] 🔥 [FCM] Background message received
```

### Terminal 3 - Device 2 Logs (Caller):
```
.\view-push-logs-device2.ps1
[Should see] [CallUser] ========== CALL INITIATED SUCCESSFULLY ==========
```

## Common Issues:

### ❌ "User is ONLINE" but app is killed
- **Solution:** Wait longer (10-15 seconds) after killing app
- Socket disconnection might be delayed

### ❌ No backend logs at all
- **Solution:** Check backend is receiving callUser socket event
- Check socket.io is working

### ❌ Backend sends but device doesn't receive
- **Solution:** Check FCM token matches
- Check FCM service account is configured
- Check internet connection

### ❌ Device receives but no notification shows
- **Solution:** Check notification permissions
- Check income library is properly set up
- Check Android notification channel

## Next Steps:

1. **Run the test with all 3 terminals logging**
2. **Check backend logs first** - is it sending?
3. **Check device logs second** - is it receiving?
4. **Share the logs** so we can identify the exact issue
