# WebRTC calling – where everything lives (backup reference)

If connection/cursor loses your work, use this to see what files to check or re-apply.

---

## Files that handle calling (mobile app only)

| File | What it does |
|------|----------------|
| `src/screens/Call/CallScreen.tsx` | Incoming UI: Answer/Decline when in-app. When **answered from native** (`shouldAutoAnswer`): shows "Connecting…" only, no Answer/Decline. Auto-answer effect + decline-on-mount. |
| `src/navigation/AppNavigator.tsx` | Navigates to CallScreen with `shouldAutoAnswer` / `shouldDecline` from native Answer/Decline. Handles pending call from MainActivity, stored call data, socket `callUser`. |
| `src/context/WebRTCContext.tsx` | `setIncomingCallFromNotification(userId, name, type, shouldAutoAnswer)`, `shouldAutoAnswerRef`, auto-answer on `callUser` when ref set, leaveCall, answerCall, etc. |
| `src/services/callData.ts` | `getPendingCallData`, `clearCallData`, `storeCallData` – used when app opens from native Answer/Decline (params: userId, userName, callType, shouldAutoAnswer, shouldDecline). |
| `src/services/fcmService.ts` | FCM call payload → notifies native (Android) for full-screen incoming call; passes Answer/Decline back to JS (e.g. MainActivity → React). |
| `android/...` (MainActivity / RN bridge) | Receives Answer/Decline from native UI, sends event to JS with `shouldAutoAnswer` or `shouldDecline`. |

---

## Key behaviors (so you can re-check after a lost session)

1. **Answer from native (app was off)**  
   App opens → navigates to CallScreen with `shouldAutoAnswer: true` → CallScreen does **not** show Answer/Decline, shows "Connecting…" → auto-answer effect runs when signal is ready.

2. **Decline from native**  
   App opens → CallScreen with `shouldDecline: true` → decline effect runs once (leaveCall + goBack).

3. **In-app incoming**  
   No `shouldAutoAnswer` → normal "Incoming call from X" + Answer + Decline.

---

## Save your work

- **Commit + push after every fix:**  
  `git add -A && git commit -m "calling: describe what you fixed" && git push`  
  So even if Cursor/connection dies, you don’t lose the day’s work.

- **Before big changes:**  
  `git checkout -b backup-calling-YYYY-MM-DD` then push that branch.

---

*(Backend is in thredtrain – do not change; all fixes stay in mobile.)*
