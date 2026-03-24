# Quick Test Guide - Immediate Call Cleanup

## Before Testing

1. **Restart Backend** (thredtrain)
   ```bash
   cd D:\thredtrain\backend
   # Stop the backend if running (Ctrl+C)
   npm start
   # OR
   node server.js
   ```

2. **Rebuild Mobile App** (trueapp)
   ```bash
   cd D:\trueapp\mobile
   # Android
   npx react-native run-android
   
   # iOS
   npx react-native run-ios
   ```

3. **Clear App Cache** (Optional but recommended)
   - Android: Settings → Apps → Your App → Clear Cache
   - iOS: Delete and reinstall

## Quick Tests (5 minutes)

### Test 1: Call → End → Call Back (MOST IMPORTANT)
**Expected: Works immediately, no delays**

1. **Device A**: Call Device B
2. **Device B**: Answer the call
3. **Device B**: End the call (press End button)
4. **Wait 0 seconds** (immediately)
5. **Device A**: Call Device B again
6. ✅ **PASS**: Call connects immediately
7. ❌ **FAIL**: "User is busy" error → Check logs below

### Test 2: Call → Cancel → Call Back
**Expected: Works immediately**

1. **Device A**: Call Device B
2. **Device A**: Cancel before B answers
3. **Wait 0 seconds** (immediately)
4. **Device B**: Call Device A
5. ✅ **PASS**: Call connects immediately
6. ❌ **FAIL**: "User is busy" error → Check logs

### Test 3: Offline Call → Decline → Call Back
**Expected: Works immediately**

1. **Device B**: Close app (background/kill)
2. **Device A**: Call Device B (B gets push notification)
3. **Device B**: Decline from notification
4. **Wait 0 seconds** (immediately)
5. **Device B**: Open app and call Device A
6. ✅ **PASS**: Call connects immediately
7. ❌ **FAIL**: "User is busy" error → Check logs

## What to Look For

### ✅ Success Signs (in logs)
```
📞 [CallUser] Media cleanup done - proceeding with new call (IMMEDIATE)
✅ [WebRTC] resetAllCallState – ready for new calls (IMMEDIATE)
📴 [HTTP cancelCall] CALLBACK_CLEANUP: Redis inCall cleared - ready for B to call A back
📞 [callUser] CALLBACK_CHECK: Busy status { receiverBusy: false, callerBusy: false }
```

### ❌ Failure Signs (in logs)

**Mobile (Device making call):**
```
❌ [WebRTC] CALLBACK_BLOCKED: callBusyError received – backend rejected the call!
```

**Backend:**
```
❌ [callUser] CALLBACK_BLOCKED: Rejecting call - user is busy
📞 [callUser] CALLBACK_CHECK: Busy status { receiverBusy: true, ... }
```

## Troubleshooting

### Problem: "User is busy" after call ends

**Check 1: Verify cleanupPeer is being called**
- Look for: `📴 [LeaveCall] Emitting cancelCall event`
- If missing → `leaveCall()` not being triggered

**Check 2: Verify backend receives cancelCall**
- Look for backend log: `📴 [cancelCall] CALLBACK_FLOW: Cancel received`
- If missing → Socket not connected or emit failed

**Check 3: Verify Redis inCall is cleared**
- Look for: `✅ [HTTP cancelCall] CALLBACK_CLEANUP: Redis inCall cleared`
- If missing → Backend not clearing Redis properly

**Check 4: Verify next call checks busy status**
- Look for: `📞 [callUser] CALLBACK_CHECK: Busy status`
- Should show `receiverBusy: false, callerBusy: false`
- If true → Redis wasn't cleared in previous step

### Problem: Camera/mic not working on second call

**Solution**: Check permissions
```bash
# Android - check logcat
adb logcat | grep -i "permission\|camera\|microphone"

# Look for permission denials
```

This should NOT happen with the new code since we don't wait for camera to "release" anymore - it's released immediately in cleanupPeer().

### Problem: Call connects but no video/audio

**Check**: Remote stream setup
```
Look for: "📹 [WebRTC] Fallback: building remote stream from getReceivers()"
```

This now happens faster (200ms, 600ms retries instead of 500ms, 1500ms).

## Log Viewing

### View Mobile Logs (Android)
```bash
npx react-native log-android
# OR
adb logcat | grep -E "CallUser|LeaveCall|CallCanceled|cancelCall|CALLBACK"
```

### View Mobile Logs (iOS)
```bash
npx react-native log-ios
```

### View Backend Logs
The backend console where you ran `npm start` should show all logs in real-time.

Filter for important logs:
```
Look for these patterns:
- 📴 [cancelCall]
- 📞 [callUser]
- ✅ [HTTP cancelCall]
- CALLBACK_FLOW
- CALLBACK_CLEANUP
- CALLBACK_BLOCKED (should NOT appear)
```

## Expected Timeline

### Old (BROKEN)
```
0ms:   User ends call
3500ms: Cooldown wait...
4000ms: Ready for new call
```
**Result**: 4 seconds of waiting 😡

### New (FIXED)
```
0ms:   User ends call
0ms:   cleanupPeer() stops tracks
0ms:   cancelCall emitted
0ms:   Backend clears Redis
0ms:   CallCanceled received
0ms:   resetAllCallState() completes
0ms:   Ready for new call
```
**Result**: Immediate, no waiting! 🚀

## Success Criteria

✅ All 3 quick tests pass without "user busy" errors
✅ No delays between ending and calling again
✅ Camera/mic work immediately on new calls
✅ Both users can call each other in any order
✅ Backend logs show `receiverBusy: false, callerBusy: false`

---

**If all tests pass → You're done! Calls now end immediately for both users! 🎉**
