# Calling – Solution Summary

Use this as the single source of truth. No more guessing.

---

## What’s in place (already done)

### Backend (`thredtrain` – socket + Redis)

- **Callback after cancel**  
  When either user is “busy” but there is **no active call** between the two in Redis, the backend clears both users’ `inCall` and allows the new call. So after a cancel, either side can call back.

- **Cancel cleanup**  
  On `cancelCall`, the backend clears Redis inCall and DB inCall for **both** caller and receiver, and deletes pending call for both.

- **ICE when receiver was offline**  
  ICE candidates are queued in Redis when the receiver is offline and delivered when they connect and send `requestCallSignal`.

- **Cancel dedupe**  
  Duplicate `cancelCall` for the same pair within 6s is ignored.

### Mobile (`trueapp`)

- **Connection timeout: 45 seconds**  
  Caller waits 45s before giving up, so the callee (e.g. in background) has time to open the app and connect before the call is cancelled.

- **Cooldown after call end: 3.5s**  
  Prevents reusing media too soon and avoids camera/mic issues.

- **Peer connection order**  
  `ontrack` is set before `addTrack`; remote stream is built from tracks so one-way video is avoided when possible.

- **Echo handling**  
  Caller ignores the echoed `callUser` event from the server so their own PC isn’t torn down.

---

## One checklist (do this and keep it)

1. **Backend**
   - Backend is the one in **`D:\thredtrain`** (where `socket.js` has the self-heal and cancel cleanup).
   - Redis is running and the backend uses it.
   - Restart the backend after any socket/Redis change.

2. **Mobile**
   - App uses **`CONNECTION_TIMEOUT: 45000`** in `src/utils/constants.ts` (already set).
   - Rebuild/run the app after changing constants or WebRTC context.

3. **Testing**
   - **Call back after cancel:** A calls B, A or B cancels. Wait a couple of seconds. B calls A (or A calls B). Call should connect, not “user busy”.
   - **Callee in background:** A calls B, B’s app is in background. B opens app within ~30–40s. B should get the incoming call and be able to answer before A’s 45s timeout.

---

## If it still fails

- **Backend logs**  
  Look for `[callUser]`, `[cancelCall]`, `CALLBACK_SELFHEAL`, `CALLBACK_BLOCKED`. They tell you if the server is rejecting the call and why.

- **Mobile logs**  
  Look for `CONNECTION TIMEOUT`, `CallCanceled`, `callBusyError`, and whether `requestCallSignal` is sent when opening from background.

- **Same backend**  
  Ensure the device/app is connecting to the same backend instance that has the updated `socket.js` (no old deploy or wrong env).

---

## Simplified “it just works” option

If you want to reduce edge cases:

- Treat **in-app calls only**: both users have the chat/call screen open. No reliance on answering from a killed/background state.
- Keep **45s timeout** and **callback-after-cancel** logic as above.
- For “missed” calls when the other was offline/background, show a “Missed call” in chat and let them call back when both are in app.

That avoids FCM/background races and pending-cancel timing; the robust path is “both in app → call works; otherwise missed call and callback later.”
