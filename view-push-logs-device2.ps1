# View push notification logs for device 2
# Usage: .\view-push-logs-device2.ps1

Write-Host "Viewing push notification logs for device 2" -ForegroundColor Cyan
Write-Host "Filtering for: FCM, OneSignal, Push, Notification, Firebase" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""
Write-Host "To find your device ID, run: adb devices" -ForegroundColor Gray
Write-Host ""

# Check if device ID is provided or get from adb devices
$devices = adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] }

if ($devices.Count -eq 0) {
    Write-Host "No devices found. Make sure your device is connected and USB debugging is enabled." -ForegroundColor Red
    exit 1
}

if ($devices.Count -eq 1) {
    $DEVICE_ID = $devices[0]
    Write-Host "Using device: $DEVICE_ID" -ForegroundColor Cyan
} else {
    Write-Host "Found $($devices.Count) devices:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $devices.Count; $i++) {
        Write-Host "  $($i + 1). $($devices[$i])" -ForegroundColor Gray
    }
    Write-Host ""
    $choice = Read-Host "Enter device number (1-$($devices.Count))"
    $DEVICE_ID = $devices[$choice - 1]
    Write-Host "Using device: $DEVICE_ID" -ForegroundColor Cyan
}

Write-Host ""
$pattern = "FCM|OneSignal|Push|Notification|Firebase|messaging|Token|incoming_call|call_ended|background|foreground"
adb -s $DEVICE_ID logcat *:S ReactNativeJS:V | Select-String -Pattern $pattern