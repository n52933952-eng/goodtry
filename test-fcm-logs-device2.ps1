# Test FCM logs for Device 2 - shows everything and filters manually
# Usage: .\test-fcm-logs-device2.ps1

Write-Host "FCM Log Test for Device 2" -ForegroundColor Cyan
Write-Host ""

# Get device 2 ID
$devices = adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] }

if ($devices.Count -lt 2) {
    Write-Host "ERROR: Need at least 2 devices connected!" -ForegroundColor Red
    exit 1
}

$DeviceId = $devices[1]
Write-Host "Using device 2: $DeviceId" -ForegroundColor Green
Write-Host ""

# Clear logs first
Write-Host "Clearing log buffer..." -ForegroundColor Yellow
adb -s $DeviceId logcat -c
Start-Sleep -Seconds 1

Write-Host ""
Write-Host "Now watching for FCM logs..." -ForegroundColor Yellow
Write-Host "Make a call from device 1 to device 2 (with device 2 app killed)" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""
Write-Host "Looking for:" -ForegroundColor Cyan
Write-Host "  - MyFirebaseMessaging" -ForegroundColor White
Write-Host "  - FCM" -ForegroundColor White
Write-Host "  - IncomingCall" -ForegroundColor White
Write-Host "  - FullscreenService" -ForegroundColor White
Write-Host ""

# Show logs and highlight FCM-related ones
adb -s $DeviceId logcat | ForEach-Object {
    $line = $_
    if ($line -match "MyFirebaseMessaging|FCM|IncomingCall|FullscreenService|FirebaseMessaging") {
        Write-Host $line -ForegroundColor Green
    } else {
        Write-Host $line
    }
}
