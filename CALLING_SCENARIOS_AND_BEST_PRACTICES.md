# Mobile Calling: Scenarios & Best Practices (WhatsApp-like, Firm & Strong)

This document traces how **User A** (caller) and **User B** (callee) behave in each scenario, and notes what is already solid vs. what to strengthen.

---

## 1. User A calls User B, User B **declines (cancels)** the call

### Flow (current behavior)

| Step | Who | What happens |
|------|-----|--------------|
| 1 | **B (mobile)** | B taps **Decline** on CallScreen → `leaveCall()` runs. |
| 2 | **B (mobile)** | `leaveCall()` computes `otherUserId = A` (caller), emits **`cancelCall`** with `{ conversationId: A, sender: B }`. |
| 3 | **Backend** | Receives `cancelCall`. Clears Redis: `activeCall`, `pendingCall`, `inCall` for both. If A were offline, would set `pendingCancel` for A. Sends **FCM `call_ended`** to **A** (so A’s phone stops ringing if in background). Emits **`CallCanceled`** to **both** A and B sockets (if connected). |
| 4 | **A (mobile)** | Receives **`CallCanceled`** → handler sets `processingCallCanceledRef`, dismisses native notification, runs cleanup (cleanupPeer, reset call state), then after 200ms resets `callEnded` and flags. CallScreen can dismiss (e.g. goBack). |
| 5 | **B (mobile)** | Already cleared by `leaveCall()`; also receives **`CallCanceled`** (idempotent). Native notification dismissed in leaveCall path. |

### Result

- **A** sees call end and can make a new call.
- **B** sees incoming UI close and is ready for new calls.
- No stuck “Calling…” or “Incoming call…” if both use current clients.

### Already firm

- Decline always goes through `leaveCall()` → `cancelCall` so backend and other peer are notified.
- Backend notifies **both** sides by socket and notifies **caller (A)** by FCM when needed.
- `CallCanceled` handler is deduped (`processingCallCanceledRef`, `callId` check) and clears state and native UI.

---

## 2. User B **not in the app** (killed or background), User A calls User B

### Flow (current behavior)

| Step | Who | What happens |
|------|-----|--------------|
| 1 | **A (mobile)** | A taps Call → `callUser(B, name, type)` → offer created, **`callUser`** emitted with signal. |
| 2 | **Backend** | `getUserSocket(B)` is null → B is offline. Sends **FCM** `incoming_call` (data-only) to **B’s `fcmToken`**. Stores **`pendingCall:B`** in Redis (callerId, name, signal, callType). Stores **`activeCall:A-B`** and marks both `inCall`. |
| 3 | **B (device)** | **Native** (e.g. IncomingCallActivity) shows full-screen incoming call, plays ringtone. Native may write **pending call** (callerId, callerName, callType, shouldAutoAnswer) to SharedPreferences / CallDataModule. |
| 4a | **B opens app (no Answer yet)** | App mounts → **AppNavigator** reads **`getPendingCallData()`** or gets **NavigateToCallScreen** from native → navigates to CallScreen with caller info. **WebRTCContext** runs **`setIncomingCallFromNotification(A, name, type, false)`** → sets call state with `signal: null`, then emits **`requestCallSignal`** `{ callerId: A, receiverId: B }`. Backend finds **activeCall** or **pendingCall**, re-sends **`callUser`** with stored offer to B’s socket. B receives **`callUser`** → sets `call.signal` → can Answer/Decline in app. |
| 4b | **B taps Answer on native UI** | Native can pass **shouldAutoAnswer**. App opens → same as 4a but with **shouldAutoAnswer**. CallScreen auto-answers when **`call.signal`** arrives (and `from` matches). |
| 5 | **A (mobile)** | Stays in “Calling…” until B answers, or B declines, or A cancels, or timeout. No “user offline” message in this path; backend treats B as “ringing” via FCM. |

### Result

- B’s phone rings even when app is killed; B can open app and get the same call (signal re-sent via `requestCallSignal`).
- Answer-from-notification is supported via `shouldAutoAnswer` and CallScreen auto-answer logic.

### Already firm

- Offline callee is handled by FCM + Redis **pendingCall**; no need for B to be online at invite time.
- **requestCallSignal** + backend re-send of **callUser** when B comes online.
- **Signal-wait timeout** (e.g. 15s): if B never gets signal, mobile emits **cancelCall** and clears so A isn’t stuck forever.
- **CallEndedFromFCM**: if A cancels while B is in background, B gets FCM `call_ended`; when B opens app, **CallEndedFromFCM** clears state so B doesn’t see stale “Incoming call…”.

### Optional strengthening

- **Caller (A) UX**: If you want A to see “Ringing on B’s device” or “User is not in app, sending ring…” instead of only “Calling…”, backend could send a one-off event when it sends FCM (e.g. `callRingingOnDevice`) so A’s UI can show that. Not required for correctness.

---

## 3. **Connection lost** (network drop, both sides)

### 3a. One side loses network (e.g. A drops), other side (B) still connected

| Step | Who | What happens |
|------|-----|--------------|
| 1 | **A (mobile)** | A’s peer connection goes **disconnected** → **failed** (or **closed**). After **ICE disconnected** timeout (e.g. 10s) or after **connection failed** and **max reconnection attempts**, mobile runs **`leaveCall()`** and emits **`cancelCall`** `{ conversationId: B, sender: A }` (if socket still up at that moment). If A’s socket is already gone, **cancelCall** is not sent. |
| 2 | **Backend** | **Option A:** A’s socket **disconnect** fires first. Backend **disconnect** handler: finds A in **activeCall**, deletes **activeCall**, clears **inCall** for A and B, emits **`CallCanceled`** to **B**. **Option B:** A’s mobile sends **cancelCall** before socket dies → same cleanup + **CallCanceled** to B + FCM **call_ended** to B if B were offline. |
| 3 | **B (mobile)** | Receives **`CallCanceled`** → same handler as “B declined”: cleanup, reset state, dismiss UI. |

### 3b. Both lose network (e.g. WiFi off for both)

| Step | Who | What happens |
|------|-----|--------------|
| 1 | **A & B** | Both sockets may disconnect; each device may see **connection failed** or **closed** after timeouts. |
| 2 | **Backend** | When **A** disconnects: cleanup **activeCall** for A–B, emit **CallCanceled** to **B** (if B still connected). When **B** disconnects: same cleanup for B, emit **CallCanceled** to **A** (if A still connected). So whoever disconnects second gets **CallCanceled**; the first to disconnect might not get it (socket already gone). |
| 3 | **A & B (mobile)** | **Connection state** handlers: on **failed** (after max reconnection), mobile calls **leaveCall()** and emits **cancelCall**. On **closed**, mobile only sets **callEnded** and clears timers; it does **not** call **leaveCall()** or **cleanupPeer()**. So: the side that gets **closed** (e.g. because the other closed the peer) only updates local state; the side that goes **failed** notifies the other via **cancelCall** when possible. If both go **failed**/disconnect, backend still cleans up when the first socket disconnects and notifies the other; the second disconnect cleans up the same call again (idempotent). |

### Result

- Backend **disconnect** handler ensures: active call is removed from Redis, **inCall** cleared for both, and the **other** user gets **CallCanceled** if still connected. So at least one side is always notified by the server when the other drops.
- Mobile: **failed** path notifies the other via **cancelCall** when socket is still up; **closed** path only resets local state (other side typically already ended or was notified by backend).

### Already firm

- Backend **disconnect** + **activeCall** cleanup + **CallCanceled** to the other user.
- Mobile **failed** + max reconnection → **cancelCall** + **leaveCall()**.
- ICE **disconnected** 10s timeout → **leaveCall()** so neither stays stuck in “Connected” with dead media.

### Implemented optimizations

1. **On `closed`** (done): In **WebRTCContext**, in the **connectionstatechange** `'closed'` branch, call **`cleanupPeer()`** (and optionally **leaveCall()** without emitting **cancelCall**, to avoid double-notify) so tracks and peer connection are always released and UI state is fully reset. WebRTCContext now calls **cleanupPeer()** and resets all call state/refs (no cancelCall emit).
2. **FCM when other user disconnects** (done): Backend could send **FCM `call_ended`** to the **other** user (the one still connected) when cleaning up on disconnect, so if that user’s app is in background they still get “call ended” and can clear native UI. Backend disconnect handler now sends FCM **call_ended** to the other user.

---

## 4. Quick reference: who sends what

| Scenario | Who acts | Socket | FCM |
|----------|----------|--------|-----|
| B declines | B | B → **cancelCall**; backend → **CallCanceled** to A and B | Backend → **call_ended** to **A** (caller) |
| A cancels (B in app) | A | A → **cancelCall**; backend → **CallCanceled** to A and B | Backend → **call_ended** to **B** (receiver) |
| A cancels (B not in app) | A | A → **cancelCall**; backend → **CallCanceled** to A; B gets nothing (offline) | Backend → **call_ended** to **B** → B’s native/JS stops ring |
| B not in app, A calls | Backend | Backend sends **callUser** to B only when B connects and sends **requestCallSignal** | Backend → **incoming_call** to B |
| A or B disconnects (e.g. network lost) | Backend (on disconnect) | Backend → **CallCanceled** to the **other** user only | Not sent today; optional to add for the other user |

---

## 5. Summary: what is already firm

- **Cancel/decline**: Always goes through **cancelCall**; both sides and FCM (for the right party) are updated.
- **B not in app**: FCM + **pendingCall** + **requestCallSignal** + re-send **callUser** when B is back; **call_ended** stops ring on B.
- **Connection lost**: Backend **disconnect** cleans **activeCall** and notifies the other user with **CallCanceled**; mobile **failed** path notifies via **cancelCall** when possible; ICE timeout calls **leaveCall()** so UI doesn’t hang.
- **Deduplication**: **callId** and **processingCallCanceledRef** (and similar) avoid duplicate handling of **CallCanceled** and stray signals.
- **Stale state**: **CallEndedFromFCM**, **pendingCancel**, **CheckPendingCancel**, and CallScreen stale-state checks keep “Incoming call…” from sticking after cancel or when returning to app.

---

## 6. Optional improvements (to make it even more firm)

1. **`connectionstatechange` → `'closed'`**: Call **cleanupPeer()** (and optionally **leaveCall()** without emitting **cancelCall**) so resources and UI are always cleaned when the peer connection closes.
2. **Backend disconnect**: When cleaning up an active call due to user disconnect, send **FCM `call_ended`** to the **other** user (the one still in the call) so they get a “call ended” even if their app is in background.
3. **Caller (A) when B is offline**: Optional backend event (e.g. **callRingingOnDevice**) so A can show “Ringing on B’s device” instead of only “Calling…”.

With these in place, behavior is very close to WhatsApp: call, cancel, answer, “user not in app”, and connection loss are all handled in a firm and predictable way on mobile and backend.
