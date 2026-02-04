# Call Implementation: Learnings from Madechess & react-native-webrtc

## Madechess (Web – simple-peer)

### How they handle media

1. **Pre-acquire stream on mount**
   - `getMediaStream()` is called once in `useEffect` when the app loads
   - Stream is created before any call starts
   - No `getUserMedia` in `callUser` or `answerCall` – they reuse the same stream

2. **callUser**
   - Uses existing `stream` – no media acquisition
   - Creates `new Peer({ initiator: true, trickle: false, stream })`
   - Stream is already ready

3. **answerCall**
   - Uses existing `stream` – no media acquisition
   - Creates `new Peer({ initiator: false, trickle: false, stream })`

4. **leaveCall**
   ```javascript
   // Stop all tracks
   if (stream) stream.getTracks().forEach(track => track.stop());
   
   // Wait 500ms, then get fresh stream
   setTimeout(() => getMediaStream(), 500);
   ```

5. **handleCallCanceled**
   - Same as leaveCall: `cleanupPeer()`, `getMediaStream()`, reset state
   - No delay – but CallCanceled means the other side ended, so caller/receiver already released

6. **No lock**
   - One shared stream
   - Re-acquire only after the previous one is fully stopped
   - 500ms delay before re-acquiring

### Backend (madechess socket.js)

- No `inCall` or Redis
- No FCM – both users must be online
- `cancelCall` only emits `CallCanceled` to both sides
- No busy check – any user can call any other user

---

## Trueapp (React Native – react-native-webrtc)

### Current approach

1. **On-demand media**
   - `getUserMedia` called when user taps Call (callUser) or Answer (answerCall)
   - No pre-acquired stream

2. **Lock**
   - Mutex around `getUserMedia` (Android can hang with concurrent calls)
   - Prefetch, warmup, and callUser compete for the lock

3. **Off-app support**
   - FCM for push when receiver is offline
   - Native `IncomingCallActivity`
   - `requestCallSignal` when app opens
   - SharedPreferences for pending call data

4. **leaveCall**
   - `cleanupPeer` → stop tracks, close peer
   - `resetAllCallState` → clear everything
   - No intentional delay before next `getUserMedia`

---

## Differences that matter for the callback issue

| Aspect | Madechess | Trueapp |
|--------|-----------|---------|
| When stream acquired | Once on mount | On call start / answer |
| Leave call → next call | 500ms delay before re-acquire | No delay; immediate re-acquire |
| Lock | None | Yes (mutex) |
| Off-app | No | Yes (FCM, native UI) |

---

## Recommendations for Trueapp

### 1. Adopt the 500ms post-call delay (madechess pattern)

In `resetAllCallState` or `leaveCall`, after `cleanupPeer()`:

```javascript
// Before user can initiate a new call, wait 500ms for Android to release camera
setTimeout(() => {
  getUserMediaInProgressRef.current = false;
  // Ready for next call
}, 500);
```

Or enforce: “no new call within 500ms of leaveCall” – if user taps Call within 500ms, either block or wait.

### 2. Pre-acquire stream when entering Messages / Chat (optional)

- When user opens Messages or a chat with call capability, pre-call `getMediaStream` once
- Store in a ref
- `callUser` reuses this stream instead of acquiring again
- When call ends: stop tracks, wait 500ms, pre-acquire again for the next call

This removes `getUserMedia` from the hot path of “user taps Call”.

### 3. Simplify the lock

- Madechess has no lock because they never call `getUserMedia` during a call
- For Trueapp: if you pre-acquire, the lock is mainly for prefetch vs answer
- Consider: only prefetch when there is no active stream; otherwise skip prefetch

### 4. LeaveCall sequence (match madechess)

```javascript
// 1. Stop tracks and cleanup peer
cleanupPeer();

// 2. Emit cancel to backend
socket.emit('cancelCall', ...);

// 3. Reset state
resetAllCallState();

// 4. After 500ms: allow next getMediaStream (or pre-acquire)
setTimeout(() => {
  readyForNextCallRef.current = true;
  // Or: preAcquireStreamForNextCall();
}, 500);
```

---

## react-native-webrtc notes

- `getUserMedia` uses `WebRTCModule.getUserMedia`
- Permissions requested before acquiring
- On Android, releasing the camera can be slower than on web
- A 500ms+ delay after `track.stop()` before the next `getUserMedia` is reasonable

---

## Action items (priority) – IMPLEMENTED ✅

1. ~~Add a 500ms “cooldown” after `leaveCall` / `resetAllCallState` before allowing `getMediaStream` again.
2. If Call is tapped during cooldown: either wait or show “Please wait…” and retry after 500ms.
3. (Optional) Pre-acquire stream when user enters a call-capable screen (Messages / Chat).
4. (Optional) Reduce or remove the lock if you move to a pre-acquire model and avoid concurrent `getUserMedia` calls.
