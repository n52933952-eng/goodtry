# Callback Flow Logs – How to Debug "B Calls A Back" Issue

When A calls B, B is off-app, then call is cancelled, and **B calls A back** (A is off-app) – if A doesn't receive the call, use these logs to find out why.

## Flow Overview

1. **A calls B** → B (off-app) gets push, answers or declines
2. **Call cancelled** (by A or B)
3. **B calls A back** → A (off-app) should get push
4. **Problem**: A doesn't receive the call

## Backend Logs (thredtrain)

### 1. When Cancel Happens (socket or HTTP)

Look for:

```
📴 [cancelCall] CALLBACK_FLOW: Cancel received
📴 [cancelCall] CALLBACK_CLEANUP: Clearing Redis inCall for both users
📴 [inCall] cancelCall AFTER clear (should be false for both)
✅ [cancelCall] CALLBACK_CLEANUP: Redis inCall cleared - ready for callback
```

If using **HTTP cancel** (e.g. app killed, Decline from native UI):

```
📴 [HTTP cancelCall] CALLBACK_FLOW: Canceling call
📴 [HTTP cancelCall] CALLBACK_CLEANUP: Clearing Redis inCall for both users
✅ [HTTP cancelCall] CALLBACK_CLEANUP: Redis inCall cleared - ready for B to call A back
```

### 2. When B Calls A Back (callUser)

Look for:

```
📴 [inCall] callUser BEFORE busy check (receiver=userToCall, caller=from)
📞 [callUser] CALLBACK_CHECK: Busy status
```

- If `receiverBusy: true` or `callerBusy: true` → **Root cause: Redis inCall not cleared**
- If `willReject: true` → Backend is blocking the call

```
❌ [callUser] CALLBACK_BLOCKED: Rejecting call - user is busy
```

### 3. If Call Passes Busy Check (A is offline)

Look for:

```
📱 [callUser] User X is OFFLINE, sending push notification (phone will ring)
📱 [callUser] CALLBACK_FCM: Sending FCM to receiver (A was off-app)
📱 [FCM] CALLBACK_FCM: Sending incoming call push to user (phone will ring)
✅ [callUser] Push notification result: ...
```

If you see `CALLBACK_FCM_BLOCKED: User not found or no FCM token` → A has no FCM token saved.

## Mobile Logs (B's Phone – Caller)

When B taps Call to reach A:

```
📤 [CallUser] CALLBACK_SCENARIO: B is calling A back
```

If B gets "User is busy":

```
❌ [WebRTC] CALLBACK_BLOCKED: callBusyError received – backend rejected the call!
```

## What Each Result Means

| Log | Meaning |
|-----|---------|
| `CALLBACK_BLOCKED: Rejecting call - user is busy` | Redis `inCall` was not cleared for A or B. Check cancel flow. |
| `CALLBACK_FCM_BLOCKED: User not found or no FCM token` | A has no FCM token. Check token registration. |
| `CALLBACK_FCM: Sending incoming call push` + success | FCM was sent. Issue may be on A's device (notification handler, battery, etc.) |
| No `callUser` logs at all | B's socket may not be connected, or `callUser` never emitted |

## Quick Test

1. A calls B (B off-app) → B gets call ✓
2. B declines
3. Check backend: `CALLBACK_CLEANUP: Redis inCall cleared`
4. B calls A (A off-app)
5. Check backend: `CALLBACK_CHECK: Busy status` – both should be `false`
6. If blocked: `CALLBACK_BLOCKED`
7. If passed: `CALLBACK_FCM: Sending incoming call push`
