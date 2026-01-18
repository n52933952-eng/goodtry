# View FCM and Push Notification Logs for Device 2
# Usage: .\view-fcm-logs-device2.ps1

Write-Host "FCM and Push Notification Log Viewer (Device 2)" -ForegroundColor Cyan
Write-Host ""

# Get device 2 ID
$devices = adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] }

if ($devices.Count -lt 2) {
    Write-Host "ERROR: Need at least 2 devices connected!" -ForegroundColor Red
    Write-Host "Connected devices:" -ForegroundColor Yellow
    $devices | ForEach-Object { Write-Host "  - $_" -ForegroundColor White }
    exit 1
}

# Use second device
$DeviceId = $devices[1]
Write-Host "Using device 2: $DeviceId" -ForegroundColor Green

Write-Host ""
Write-Host "Filtering logs for:" -ForegroundColor Yellow
Write-Host "  - FCM (Firebase Cloud Messaging)" -ForegroundColor Gray
Write-Host "  - MyFirebaseMessaging" -ForegroundColor Gray
Write-Host "  - Income library (IncomingCallService)" -ForegroundColor Gray
Write-Host "  - Push notifications" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Filter logs - use simple pattern matching
$pattern = "MyFirebaseMessaging|FullscreenService|IncomingCallService|FCM|FirebaseMessaging|ReactNativeJS.*FCM|ReactNativeJS.*push|ReactNativeJS.*notification|ReactNativeJS.*income|ReactNativeJS.*call"

# Clear log buffer first
adb -s $DeviceId logcat -c

Write-Host "Starting logcat (logs will appear below)..." -ForegroundColor Green
Write-Host ""

# Show logs with filtering
adb -s $DeviceId logcat | Select-String -Pattern $pattern
