# View ALL logs for Device 2 (simplified, no filtering)
# Usage: .\view-all-logs-device2.ps1

Write-Host "Viewing ALL logs for Device 2" -ForegroundColor Cyan
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
Write-Host "Showing ALL logs (no filtering)" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Show all logs without filtering
adb -s $DeviceId logcat
