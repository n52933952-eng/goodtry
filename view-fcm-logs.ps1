# View FCM and Push Notification Logs
# Usage: .\view-fcm-logs.ps1 [device_id]

param(
    [string]$DeviceId = ""
)

Write-Host "FCM and Push Notification Log Viewer" -ForegroundColor Cyan
Write-Host ""

# Get device ID if not provided
if ([string]::IsNullOrEmpty($DeviceId)) {
    $devices = adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] }
    
    if ($devices.Count -eq 0) {
        Write-Host "ERROR: No devices found!" -ForegroundColor Red
        exit 1
    } elseif ($devices.Count -eq 1) {
        $DeviceId = $devices[0]
        Write-Host "Using device: $DeviceId" -ForegroundColor Green
    } else {
        Write-Host "WARNING: Multiple devices found:" -ForegroundColor Yellow
        for ($i = 0; $i -lt $devices.Count; $i++) {
            Write-Host "  $($i + 1). $($devices[$i])" -ForegroundColor White
        }
        $selection = Read-Host "Select device number"
        $DeviceId = $devices[$selection - 1]
    }
}

Write-Host ""
Write-Host "Filtering logs for:" -ForegroundColor Yellow
Write-Host "  - FCM (Firebase Cloud Messaging)" -ForegroundColor Gray
Write-Host "  - MyFirebaseMessaging" -ForegroundColor Gray
Write-Host "  - Income library (IncomingCallService)" -ForegroundColor Gray
Write-Host "  - Push notifications" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Filter logs
$filters = @(
    "MyFirebaseMessaging",
    "FullscreenService",
    "IncomingCallService",
    "FCM",
    "FirebaseMessaging",
    "ReactNativeJS.*FCM",
    "ReactNativeJS.*push",
    "ReactNativeJS.*notification",
    "ReactNativeJS.*income",
    "ReactNativeJS.*call"
)

$filterString = ($filters | ForEach-Object { "tag:$_" }) -join "|"

if ([string]::IsNullOrEmpty($DeviceId)) {
    adb logcat | Select-String -Pattern $filterString
} else {
    adb -s $DeviceId logcat | Select-String -Pattern $filterString
}
