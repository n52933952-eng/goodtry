# View React Native logs for Device 2
# Usage: .\view-reactnative-logs-device2.ps1

Write-Host "Viewing React Native logs for Device 2" -ForegroundColor Cyan
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
Write-Host "Showing React Native JS logs" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Show React Native logs
adb -s $DeviceId logcat *:S ReactNativeJS:V
