# Trueapp Mobile WebRTC – Cases & Best Practices

Web and mobile share the **same backend** (in the **thredtrain** folder). This doc covers all call cases and mobile responsibilities. **Do not create a backend in trueapp** – use thredtrain.

---

## Backend (thredtrain)

- **Location:** `thredtrain/backend` (socket: `thredtrain/backend/socket/socket.js`).
- **Socket events:** `callUser`, `answerCall`, `iceCandidate`, `requestCallSignal`, `cancelCall`.
- **cancelCall:** Backend emits **CallCanceled** to **both** users (conversationId + sender) when there was an active call, so **one cancel ends the call on both sides**. When caller cancels before answer, sender still gets CallCanceled.
- **Payload from mobile:** `cancelCall` sends `{ conversationId: otherUserId, sender: currentUserId, callId? }`. Backend uses `conversationId` = other user to notify, `sender` = who canceled.

---

## Call Cases

### 1. In-app: A calls B, B in app

- A taps Call → CallScreen → `callUser(B)` → offer + ICE.
- Backend forwards `callUser` to B (and echo to A). B sees incoming → Answer / Decline.
- **Answer:** B sends answer + ICE → both connect.
- **Decline:** B calls `leaveCall()` → `cancelCall` → backend emits CallCanceled to A (and B) → both end.
- **Either taps End:** That side calls `leaveCall()` → `cancelCall` → backend emits CallCanceled to the other → both end, state reset.

### 2. Push: A calls B, B not in app

- Backend sends FCM to B; B’s phone rings (native incoming UI).
- **B declines:** Native/HTTP cancel → backend emits CallCanceled to A (and FCM to stop ring) → both end.
- **B answers:** App opens → NavigateToCallScreen → CallScreen with `shouldAutoAnswer` → `requestCallSignal` → backend re-sends `callUser` with stored offer → mobile auto-answers → answer + ICE → connect.
- **Either taps End:** Same as in-app: `leaveCall()` / `cancelCall` → CallCanceled to other → both end.

### 3. Cancel on both sides

- When **any** user presses End, mobile emits `cancelCall` with `{ conversationId: otherUserId, sender: currentUserId }`.
- Thredtrain backend emits **CallCanceled** to the socket of **conversationId** (the other user) and to **sender**. Both apps handle CallCanceled → cleanup, set callEnded, dismiss CallScreen.

### 4. Busy / offline

- Backend detects user in call or offline → sends **callBusyError** (e.g. `reason: 'busy'` or `'offline'`).
- Mobile shows message, resets state, allows new call after short delay.

### 5. Connection lost (ICE failed, disconnect)

- Mobile: on ICE failed / connection failed (after reconnection attempts), call `leaveCall()` and emit `cancelCall` if socket is up.
- Mobile: on connection state `closed`, cleanup locally (no cancelCall – other side already ended or will get CallCanceled from backend).
- Backend: on socket disconnect, clears active call and can emit CallCanceled to the other user.

### 6. Stuck state (can’t call again)

- If call ended but state wasn’t cleared (e.g. no CallCanceled received): ICE-failed path and ChatScreen “stuck state” escape hatch clear state and allow new call (leaveCall + retry after delay).

---

## Mobile Responsibilities (Best Practices)

1. **leaveCall()** always emits `cancelCall` with `{ conversationId: otherUserId, sender: currentUserId }` when there is an active call (so backend can notify the other user).
2. **CallCanceled** handler: cleanup peer, clear all call state and refs, set callEnded, then reset callEnded after short delay so CallScreen dismisses and user can call again.
3. **Guards:** Use refs (`leaveCallInProgressRef`, `processingCallCanceledRef`, `isAnsweringRef`) so leave/answer/cancel don’t run twice or race.
4. **callId:** Ignore events (callBusyError, callConnected, iceCandidate, CallCanceled) only when **both** `data.callId` and `activeCallIdRef.current` are set **and** different. If we don’t have a callId yet, accept the event.
5. **Notification flow:** Use `setIncomingCallFromNotification` only when actually navigating/updating CallScreen (not on every duplicate NavigateToCallScreen). Request signal when socket connects; backend re-sends `callUser` from stored pending/active call.
6. **No backend in trueapp:** All socket/HTTP call logic lives in **thredtrain** backend. Mobile only connects to that backend (configure URL in constants).

---

## Socket Event Summary

| Mobile sends     | Backend (thredtrain)        | Mobile receives   |
|------------------|-----------------------------|-------------------|
| callUser         | Forward to userToCall, store | callUser          |
| answerCall       | Forward to data.to          | callAccepted      |
| iceCandidate     | Forward to userToCall       | iceCandidate      |
| requestCallSignal| Re-send callUser to receiver| callUser          |
| cancelCall       | Emit CallCanceled to both   | CallCanceled      |

This keeps mobile and web aligned with one backend and covers all cases above.
