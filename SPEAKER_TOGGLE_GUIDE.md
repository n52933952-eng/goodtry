# 📱 Speaker Toggle - Quick Reference

## Feature Summary
Users can now toggle between **speaker** and **earpiece** during calls with a single tap.

---

## Visual Guide

### Video Call Controls
```
┌─────────────────────────────────────┐
│                                     │
│        📹 Video Call                │
│         00:15                       │
│                                     │
│         [Remote Video]              │
│                                     │
│    ┌────────────┐                  │
│    │[Local Cam] │                  │
│    └────────────┘                  │
│                                     │
│  ───────────────────────────────   │
│                                     │
│   🎤    🔊    📹    🔄    📞      │
│  Mute Speaker Camera Flip  End     │
│                                     │
└─────────────────────────────────────┘
```

### Audio Call Controls
```
┌─────────────────────────────────────┐
│                                     │
│        📞 Voice Call                │
│         00:42                       │
│                                     │
│            ╔════╗                   │
│            ║ JD ║                   │
│            ╚════╝                   │
│         John Doe                    │
│         Connected                   │
│                                     │
│  ───────────────────────────────   │
│                                     │
│       🎤    🔊    📞               │
│      Mute Speaker  End              │
│                                     │
└─────────────────────────────────────┘
```

---

## Button States

### Speaker Button (Earpiece Mode)
```
┌──────┐
│  📱  │  ← Transparent background
└──────┘
  Tap to enable speaker
```

### Speaker Button (Speaker Mode)
```
┌──────┐
│  🔊  │  ← Blue background (active)
└──────┘
  Tap to switch to earpiece
```

---

## Default Behavior

| Call Type    | Default Audio Output | Reason                          |
|--------------|---------------------|---------------------------------|
| Video Call   | 🔊 **Speaker**      | Hands-free for viewing video    |
| Audio Call   | 📱 **Earpiece**     | Privacy for voice conversations |

---

## User Actions

### Scenario 1: Video Call Privacy
```
1. Start video call → Speaker ON by default
2. Need privacy? → Tap speaker button (📱)
3. Audio switches to earpiece
4. Want hands-free again? → Tap speaker button (🔊)
```

### Scenario 2: Audio Call Hands-Free
```
1. Start audio call → Earpiece by default
2. Need hands-free? → Tap speaker button (🔊)
3. Audio switches to speaker
4. Back to private? → Tap speaker button (📱)
```

---

## Technical Implementation

### Audio Routing Logic
- Uses `react-native-incall-manager` for native audio control
- Respects system audio policies
- Integrates with Bluetooth/wired headsets
- Survives app backgrounding

### Key Functions
```typescript
// Toggle between speaker and earpiece
toggleSpeaker() 
  → isSpeakerOn = !isSpeakerOn
  → InCallManager.setForceSpeakerphoneOn(isSpeakerOn)

// Initialize audio routing on call start
getMediaStream(type)
  → Video: InCallManager.start({ media: 'video', auto: true })
  → Audio: InCallManager.start({ media: 'audio', auto: false })

// Cleanup on call end
cleanupPeer()
  → InCallManager.stop()
  → Reset isSpeakerOn to false
```

---

## Testing Checklist

- [ ] Video call starts with speaker ON
- [ ] Audio call starts with earpiece (speaker OFF)
- [ ] Speaker button toggles audio output
- [ ] Button visual state updates (blue background when active)
- [ ] Speaker state persists during call
- [ ] Audio resets to earpiece after call ends
- [ ] Works with Bluetooth headsets
- [ ] Works with wired headphones
- [ ] No audio issues when toggling multiple times

---

## Accessibility

- **Visual:** Clear emoji indicators (🔊/📱)
- **Color:** Blue highlight for active state
- **Touch Target:** 60x60px button size
- **Feedback:** Immediate audio switch

---

## Browser/Platform Support

| Platform | Support | Notes                                  |
|----------|---------|----------------------------------------|
| iOS      | ✅      | Full support via InCallManager         |
| Android  | ✅      | Full support via InCallManager         |
| Web      | N/A     | (Mobile app only)                      |
