# View ALL FCM-related logs for Device 2 (no filtering, shows everything)
# Usage: .\view-all-fcm-logs-device2.ps1

Write-Host "Viewing ALL logs for Device 2 (no filter)" -ForegroundColor Cyan
Write-Host "This will show everything - look for 'FCM', 'MyFirebaseMessaging', 'IncomingCall'" -ForegroundColor Yellow
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
Write-Host "Showing ALL logs (no filter) - press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Show all logs - user can search manually
adb -s $DeviceId logcat
