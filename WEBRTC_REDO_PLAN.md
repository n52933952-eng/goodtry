# Mobile WebRTC + Backend Redo Plan

## What we keep (do not change)

- **Web (thredtrain/frontent):** WebRTC in SocketContext (simple-peer, callUser/answerCall/cancelCall/CallCanceled). Same socket events and payloads must keep working.
- **Push notifications:** FCM setup, incoming_call payload, native handling. No changes to fcmService or backend FCM send.
- **Native answer/decline:** IncomingCallActivity, Answer/Decline buttons, foreground UI. No changes to native modules or callData (getPendingCallData, setCurrentUserId, etc.).
- **Navigation:** AppNavigator routing to CallScreen, NavigateToCallScreen event, params (callerId, callerName, callType, shouldAutoAnswer). We only change how WebRTCContext responds; same entry points.

---

## Backend contract (must stay for web compatibility)

Socket events the **web** uses (backend must keep these names and shapes):

| Event            | Direction   | Web payload / expectation |
|------------------|------------|---------------------------|
| `callUser`       | Client→Server | `{ userToCall, signalData, from, name, callType }` (offer in signalData) |
| `callUser`       | Server→Client | Receiver gets `{ from, name, userToCall, signal?, callType }` (signal = offer for web) |
| `callAccepted`   | Server→Client | Caller gets answer signal (single signal) |
| `answerCall`     | Client→Server | `{ signal, to }` (answer) |
| `cancelCall`     | Client→Server | `{ conversationId, sender }` |
| `CallCanceled`   | Server→Client | Both sides get it (no payload required) |
| `iceCandidate`   | Both         | Mobile uses; web uses trickle:false so optional for web |

Backend can add mobile-only events (e.g. `requestCallSignal`) and Redis/FCM logic as long as the above still work for web.

---

## Target behavior (simple, like WhatsApp)

### Case 1: Both in app (A and B online)

1. **A calls B**  
   - A: get media → create PC → create offer → emit `callUser` with signal (offer).  
   - Backend: if B online, emit `callUser` to B with offer; mark both inCall.  
   - B: receives `callUser` → show incoming UI (already there); can **Answer** or **Decline**.

2. **B declines**  
   - B: emit `cancelCall(conversationId: A, sender: B)` → cleanup local media.  
   - Backend: clear inCall for both, emit `CallCanceled` to A.  
   - A: on `CallCanceled` → cleanup, reset. **End for both.**

3. **B answers**  
   - B: get media → create PC → setRemoteDescription(offer) → create answer → emit `answerCall({ signal, to: A })`.  
   - Backend: emit `callAccepted(signal)` to A.  
   - A: setRemoteDescription(answer), ICE exchange (trickle).  
   - Both: connected, talking. Either can **End**.

4. **Either ends**  
   - Who ends: cleanup local media, emit `cancelCall(conversationId: other, sender: me)`.  
   - Backend: clear inCall, emit `CallCanceled` to the other.  
   - Other: on `CallCanceled` (and/or connection closed) → cleanup local media, reset. **End for both, clear everything.** Either can call again.

### Case 2: B offline, gets call (FCM + native UI)

1. **A calls B**  
   - Backend: B offline → store pending call, send FCM (incoming_call). Native shows IncomingCallActivity (unchanged).

2. **B taps Answer on native UI**  
   - App opens, navigates to CallScreen with shouldAutoAnswer + callerId (unchanged).  
   - WebRTCContext: `setIncomingCallFromNotification(callerId, name, callType, true)` already called; we **request offer** from backend (`requestCallSignal`).  
   - Backend: when B connects, sends stored offer (or asks A to resend) → emit `callUser` to B with signal.  
   - B: receive `callUser` with signal → **auto-answer** (create PC, set remote offer, create answer, emit `answerCall`).  
   - A: receives `callAccepted` → set remote answer. ICE exchange. **Auto start talking.** Scalable.

3. **Either ends**  
   - Same as Case 1: end → cancelCall → CallCanceled → cleanup both. **Firm end.** Then either can call back (or other can end). Like WhatsApp.

---

## Implementation scope

### 1. Backend (thredtrain/backend/socket/socket.js)

- **Keep:** All event names and payloads used by web (see table above). Keep Redis (inCall, pendingCall, activeCall) and FCM (send on incoming when offline, send “call ended” on cancel when receiver offline).
- **Simplify:** Logic inside `callUser`, `answerCall`, `cancelCall`, `iceCandidate`, `requestCallSignal`. One clear path per event; no extra branches that aren’t needed for web + mobile.
- **Do not change:** Web app (frontent), FCM service code, push notification payload structure.

### 2. Mobile (trueapp/mobile)

- **Replace:** WebRTC logic inside `WebRTCContext.tsx` only. New implementation:
  - **State:** `call`, `callAccepted`, `callEnded`, `isCalling`, `localStream`, `remoteStream`, `peerConnection`, `callType`. Minimal refs (e.g. otherUserId for cancel).
  - **callUser(id, name, type):** Get media → create PC → create offer → emit `callUser`. On `callAccepted` set remote answer; ICE send/receive. On end or cancel: leaveCall().
  - **Incoming (socket `callUser`):** Set `call` (isReceivingCall, from, name, signal if present). If no signal (offline flow), emit `requestCallSignal`; when signal arrives, same handler. Answer button → answerCall(). Decline → leaveCall() (emit cancelCall).
  - **answerCall():** Get media → create PC → setRemoteDescription(offer) → create answer → emit `answerCall` → setLocalDescription. ICE. On end: leaveCall().
  - **leaveCall():** cleanupPeer() (stop all tracks, close PC, clear refs), emit `cancelCall(conversationId: other, sender: me)`, reset state.
  - **CallCanceled:** cleanupPeer(), reset state.
  - **Connection closed:** cleanupPeer(), reset state.
- **Keep same public API:** Same context value (localStream, remoteStream, call, callAccepted, callEnded, isCalling, callType, callUser, answerCall, leaveCall, setIncomingCallFromNotification, requestCallSignalForCaller, etc.) so CallScreen, ChatScreen, AppNavigator need no changes (or minimal prop names).
- **Do not change:** FCM, callData, native answer/decline, AppNavigator navigation to CallScreen or params (callerId, shouldAutoAnswer, etc.). Only the internal WebRTC implementation in WebRTCContext.

### 3. Files to touch

| Area    | File(s) | Action |
|---------|---------|--------|
| Backend | `thredtrain/backend/socket/socket.js` | Simplify call handlers; keep web contract and FCM/Redis. |
| Mobile  | `trueapp/mobile/src/context/WebRTCContext.tsx` | Replace with new minimal WebRTC implementation; keep same exports. |
| Mobile  | `trueapp/mobile/src/screens/Call/CallScreen.tsx` | Only if we rename any prop; otherwise no change. |
| Mobile  | `trueapp/mobile/src/screens/Messages/ChatScreen.tsx` | Only if we change callUser/leaveCall signature; otherwise no change. |
| Mobile  | `trueapp/mobile/src/navigation/AppNavigator.tsx` | No change (still pass same params, same events). |

---

## Order of work

1. **Backend:** Refactor socket call handlers (callUser, answerCall, cancelCall, iceCandidate, requestCallSignal) to be clear and minimal while keeping web behavior and mobile offline/FCM flow.
2. **Mobile:** Rewrite WebRTCContext.tsx (new file or in-place): implement callUser, answerCall, leaveCall, incoming callUser handler, CallCanceled, connection closed; keep same context interface and setIncomingCallFromNotification/requestCallSignalForCaller for native + FCM.
3. **Test:** Both in app (call, answer, decline, end); then B offline (FCM, native answer, auto start, end, call back).

This keeps web WebRTC, push, and native answer/decline untouched and redoes only mobile call logic and backend call flow so both cases are simple and firm like WhatsApp.
