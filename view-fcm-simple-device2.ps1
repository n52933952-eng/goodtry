# View FCM logs for Device 2 (simplified filtering)
# Usage: .\view-fcm-simple-device2.ps1

Write-Host "Viewing FCM logs for Device 2" -ForegroundColor Cyan
Write-Host ""

# Get device 2 ID
$devices = adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] }

if ($devices.Count -lt 2) {
    Write-Host "ERROR: Need at least 2 devices connected!" -ForegroundColor Red
    exit 1
}

# Use second device
$DeviceId = $devices[1]
Write-Host "Using device 2: $DeviceId" -ForegroundColor Green
Write-Host ""
Write-Host "Filtering for: FCM, Firebase, MyFirebaseMessaging, IncomingCall" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Simple pattern matching
adb -s $DeviceId logcat | Select-String -Pattern "FCM|Firebase|MyFirebaseMessaging|IncomingCall|FullscreenService|ReactNativeJS.*FCM|ReactNativeJS.*push|ReactNativeJS.*notification"
