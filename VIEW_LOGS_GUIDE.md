# 📱 How to View Logs from Both Devices

## Option 1: Two Separate Terminals (Recommended)

This is the **best method** for viewing logs from both devices simultaneously.

### Terminal 1 - Device 1:
```powershell
cd D:\trueapp\mobile
.\view-logs-device1.ps1
```

Or use the detailed version:
```powershell
.\view-logs-device1-detailed.ps1
```

### Terminal 2 - Device 2:
```powershell
cd D:\trueapp\mobile
.\view-logs-device2.ps1
```

Or use the detailed version:
```powershell
.\view-logs-device2-detailed.ps1
```

## Option 2: Manual adb Commands

### Device 1:
```powershell
adb -s 129065548A000773 logcat *:S ReactNativeJS:V | Select-String -Pattern "FCM|OneSignal|WebRTC|ICE|CallUser|AnswerCall|IncomingCall|Socket|callUser|EVENT|ChatScreen|CallScreen"
```

### Device 2:
```powershell
adb -s <DEVICE_2_ID> logcat *:S ReactNativeJS:V | Select-String -Pattern "FCM|OneSignal|WebRTC|ICE|CallUser|AnswerCall|IncomingCall|Socket|callUser|EVENT|ChatScreen|CallScreen"
```

To find Device 2 ID:
```powershell
adb devices
```

## Option 3: Push Notification Logs Only

### Device 1 - Push Logs:
```powershell
.\view-push-logs.ps1
```

### Device 2 - Push Logs:
```powershell
.\view-push-logs-device2.ps1
```

## Available Scripts:

1. **`view-logs-device1.ps1`** - Device 1 (pre-configured ID)
2. **`view-logs-device2.ps1`** - Device 2 (auto-detects)
3. **`view-logs-device1-detailed.ps1`** - Device 1 with more keywords
4. **`view-logs-device2-detailed.ps1`** - Device 2 with more keywords
5. **`view-push-logs.ps1`** - Push notifications for Device 1
6. **`view-push-logs-device2.ps1`** - Push notifications for Device 2
7. **`view-logs-both-devices.ps1`** - Helper script (shows instructions)

## Log Filter Keywords:

The scripts filter for these keywords:
- **FCM** - Firebase Cloud Messaging
- **OneSignal** - OneSignal notifications
- **WebRTC** - WebRTC call logs
- **ICE** - ICE candidate logs
- **CallUser** - Call initiation logs
- **AnswerCall** - Answer call logs
- **IncomingCall** - Incoming call logs
- **Socket** - Socket.IO events
- **callUser** - callUser event logs
- **EVENT** - Socket events
- **ChatScreen** - Chat screen logs
- **CallScreen** - Call screen logs

## Quick Start:

1. **Open 2 terminals in VS Code or PowerShell**
2. **Terminal 1**: Run `.\view-logs-device1.ps1`
3. **Terminal 2**: Run `.\view-logs-device2.ps1`
4. **Start testing** - logs from both devices will appear in real-time!

## Tips:

- Press **Ctrl+C** to stop log monitoring
- Use **Ctrl+Shift+`** in VS Code to open new terminal
- Each terminal window will show logs from its respective device
- Device 1 logs appear in **green**, Device 2 in **blue** (if using detailed scripts)
