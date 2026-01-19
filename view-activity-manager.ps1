# View ActivityManager logs only
# Usage: .\view-activity-manager.ps1 [device_id]
# If no device_id provided and multiple devices exist, shows available devices

param(
    [string]$DeviceId = ""
)

Write-Host "📋 ActivityManager Logs" -ForegroundColor Cyan
Write-Host ""

# Get list of devices
$deviceList = adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] }

if ($deviceList.Count -gt 1 -and $DeviceId -eq "") {
    Write-Host "⚠️ Multiple devices detected. Choose one:" -ForegroundColor Yellow
    Write-Host ""
    $index = 1
    foreach ($device in $deviceList) {
        Write-Host "  $index. $device" -ForegroundColor White
        $index++
    }
    Write-Host ""
    Write-Host "Usage:" -ForegroundColor Yellow
    Write-Host "  .\view-activity-manager.ps1 -DeviceId $($deviceList[0])" -ForegroundColor White
    Write-Host ""
    Write-Host "Or use directly:" -ForegroundColor Yellow
    Write-Host "  adb -s $($deviceList[0]) logcat *:S ActivityManager:V" -ForegroundColor White
} elseif ($DeviceId -ne "") {
    Write-Host "Starting ActivityManager logs on device: $DeviceId" -ForegroundColor Green
    adb -s $DeviceId logcat *:S ActivityManager:V
} else {
    Write-Host "Starting ActivityManager logs..." -ForegroundColor Green
    adb logcat *:S ActivityManager:V
}
