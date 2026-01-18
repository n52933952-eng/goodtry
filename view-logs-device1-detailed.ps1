# View detailed logs for device 1
# Usage: .\view-logs-device1-detailed.ps1

$DEVICE_ID = "129065548A000773"

# Get device ID if not provided or if device not found
$devices = adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] }

if ($devices.Count -eq 0) {
    Write-Host "❌ No devices found. Make sure your device is connected." -ForegroundColor Red
    exit 1
}

if ($devices.Count -eq 1) {
    $DEVICE_ID = $devices[0]
} else {
    $DEVICE_ID = $devices[0]
    Write-Host "📱 Using first device: $DEVICE_ID" -ForegroundColor Yellow
}

Write-Host "📱 Device 1 Logs: $DEVICE_ID" -ForegroundColor Green
Write-Host "Filtering for: FCM, OneSignal, WebRTC, ICE, CallUser, AnswerCall, Socket" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

adb -s $DEVICE_ID logcat *:S ReactNativeJS:V | Select-String -Pattern "FCM|OneSignal|WebRTC|ICE|CallUser|AnswerCall|IncomingCall|Socket|callUser|EVENT|ChatScreen|CallScreen"