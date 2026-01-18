# View detailed logs for device 2
# Usage: .\view-logs-device2-detailed.ps1

Write-Host "📱 Device 2 Logs" -ForegroundColor Blue
Write-Host "Filtering for: FCM, OneSignal, WebRTC, ICE, CallUser, AnswerCall, Socket" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

# Get all connected devices
$devices = adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] }

if ($devices.Count -eq 0) {
    Write-Host "❌ No devices found. Make sure your devices are connected." -ForegroundColor Red
    exit 1
}

if ($devices.Count -eq 1) {
    Write-Host "⚠️ Only 1 device found. Using that device:" -ForegroundColor Yellow
    $DEVICE_ID = $devices[0]
} else {
    Write-Host "📱 Found $($devices.Count) devices:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $devices.Count; $i++) {
        $color = if ($i -eq 0) { "Green" } else { "Blue" }
        Write-Host "  $($i + 1). $($devices[$i])" -ForegroundColor $color
    }
    
    if ($devices.Count -eq 2) {
        $DEVICE_ID = $devices[1]
        Write-Host ""
        Write-Host "📱 Using Device 2: $DEVICE_ID" -ForegroundColor Blue
    } else {
        Write-Host ""
        $choice = Read-Host "Enter device number (2-$($devices.Count))"
        if ($choice -ge 2 -and $choice -le $devices.Count) {
            $DEVICE_ID = $devices[$choice - 1]
            Write-Host "📱 Using Device $choice : $DEVICE_ID" -ForegroundColor Blue
        } else {
            Write-Host "❌ Invalid choice. Using Device 2." -ForegroundColor Yellow
            $DEVICE_ID = $devices[1]
        }
    }
}

Write-Host ""

adb -s $DEVICE_ID logcat *:S ReactNativeJS:V | Select-String -Pattern "FCM|OneSignal|WebRTC|ICE|CallUser|AnswerCall|IncomingCall|Socket|callUser|EVENT|ChatScreen|CallScreen"