# 🔊 Speaker Toggle Feature

## Overview
Added speaker/earpiece toggle functionality to the calling feature, allowing users to switch between speaker and earpiece during audio and video calls.

## Changes Made

### 1. **WebRTCContext.tsx** - Core Audio Routing Logic

#### Added Dependencies
```typescript
import InCallManager from 'react-native-incall-manager';
```

#### New State & Interface
- Added `isSpeakerOn` state to track speaker status
- Added `toggleSpeaker` function to interface
- Added `isSpeakerOn` to interface exports

#### InCallManager Integration
**On Call Start (`getMediaStream`):**
- Initializes InCallManager when media stream is created
- Video calls default to **speaker ON**
- Audio calls default to **earpiece** (speaker OFF)
```typescript
const media = type === 'video' ? 'video' : 'audio';
const auto = type === 'video'; // Auto-enable speaker for video calls
InCallManager.start({ media, auto, ringback: '' });
```

**Toggle Function:**
```typescript
const toggleSpeaker = () => {
  const newSpeakerState = !isSpeakerOn;
  setIsSpeakerOn(newSpeakerState);
  
  if (newSpeakerState) {
    InCallManager.setForceSpeakerphoneOn(true);
  } else {
    InCallManager.setForceSpeakerphoneOn(false);
  }
};
```

**On Call End (`cleanupPeer`):**
- Stops InCallManager and resets audio routing
- Resets `isSpeakerOn` to false

### 2. **CallScreen.tsx** - UI Controls

#### New Button Added
- Added speaker toggle button between mute and camera buttons
- Shows 🔊 emoji when speaker is ON
- Shows 📱 emoji when earpiece is ON (speaker OFF)
- Button highlights when speaker is active (using `controlButtonActive` style)
- Available for **both audio and video calls**

#### Button Layout
```
[Mute] [Speaker] [Camera] [Switch] [End Call]  // Video calls
[Mute] [Speaker] [End Call]                     // Audio calls
```

## User Experience

### Video Calls
- **Default:** Speaker ON (hands-free experience)
- User can toggle to earpiece for privacy

### Audio Calls
- **Default:** Earpiece (private conversation)
- User can toggle to speaker for hands-free

### Visual Feedback
- Button background changes color when speaker is active
- Clear emoji indicators (🔊 speaker / 📱 earpiece)

## Technical Details

### Package Used
- `react-native-incall-manager` (v4.2.1)
- Already installed in package.json
- Handles native audio routing on both iOS and Android

### Key Features
✅ Automatic speaker activation for video calls
✅ Earpiece default for audio calls
✅ Manual toggle available during calls
✅ Proper cleanup on call end
✅ Consistent UI across call types
✅ Native audio routing optimization

## Testing
To test the feature:
1. **Video Call:**
   - Start video call → Speaker should be ON by default
   - Tap speaker button → Should switch to earpiece
   - Tap again → Should switch back to speaker

2. **Audio Call:**
   - Start audio call → Earpiece should be active by default
   - Tap speaker button → Should switch to speaker
   - Tap again → Should switch back to earpiece

## Files Modified
1. `src/context/WebRTCContext.tsx` - Core logic
2. `src/screens/Call/CallScreen.tsx` - UI controls

## Future Enhancements
- Bluetooth headset detection and auto-routing
- Audio device selection menu (speaker/earpiece/bluetooth)
- Persist user preference for speaker setting
- Accessibility improvements for hearing-impaired users
