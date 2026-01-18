# View logs from both devices simultaneously
# Usage: .\view-both-devices-logs.ps1

Write-Host "FCM and Push Notification Log Viewer (Both Devices)" -ForegroundColor Cyan
Write-Host ""

# Get all connected devices
$devices = adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] }

if ($devices.Count -lt 2) {
    Write-Host "ERROR: Need at least 2 devices connected!" -ForegroundColor Red
    Write-Host "Connected devices:" -ForegroundColor Yellow
    $devices | ForEach-Object { Write-Host "  - $_" -ForegroundColor White }
    exit 1
}

$device1 = $devices[0]
$device2 = $devices[1]

Write-Host "Device 1: $device1" -ForegroundColor Green
Write-Host "Device 2: $device2" -ForegroundColor Green
Write-Host ""
Write-Host "To view logs from both devices:" -ForegroundColor Yellow
Write-Host ""
Write-Host "OPTION 1 - View in separate terminals (RECOMMENDED):" -ForegroundColor Cyan
Write-Host ""
Write-Host "Terminal 1 (Device 1):" -ForegroundColor White
Write-Host "  adb -s $device1 logcat | Select-String -Pattern 'MyFirebaseMessaging|IncomingCallActivity|RingtoneService|FCM|FirebaseMessaging|ReactNativeJS.*call|ReactNativeJS.*FCM'" -ForegroundColor Gray
Write-Host ""
Write-Host "Terminal 2 (Device 2):" -ForegroundColor White
Write-Host "  adb -s $device2 logcat | Select-String -Pattern 'MyFirebaseMessaging|IncomingCallActivity|RingtoneService|FCM|FirebaseMessaging|ReactNativeJS.*call|ReactNativeJS.*FCM'" -ForegroundColor Gray
Write-Host ""
Write-Host "OPTION 2 - View all logs (less filtered):" -ForegroundColor Cyan
Write-Host ""
Write-Host "Terminal 1:" -ForegroundColor White
Write-Host "  adb -s $device1 logcat *:S MyFirebaseMessaging:V IncomingCallActivity:V RingtoneService:V ReactNativeJS:V" -ForegroundColor Gray
Write-Host ""
Write-Host "Terminal 2:" -ForegroundColor White
Write-Host "  adb -s $device2 logcat *:S MyFirebaseMessaging:V IncomingCallActivity:V RingtoneService:V ReactNativeJS:V" -ForegroundColor Gray
Write-Host ""
Write-Host "OPTION 3 - View with device name prefix:" -ForegroundColor Cyan
Write-Host ""
Write-Host "Run this command to see logs from both devices with prefixes:" -ForegroundColor White
Write-Host ""
Write-Host "Device 1 logs:" -ForegroundColor Green
Write-Host "  Get-Content -Path (adb -s $device1 logcat *:S MyFirebaseMessaging:V IncomingCallActivity:V RingtoneService:V ReactNativeJS:V) | ForEach-Object { Write-Host '[DEVICE1] $_' -ForegroundColor Green }" -ForegroundColor Gray
Write-Host ""
Write-Host "Device 2 logs:" -ForegroundColor Yellow
Write-Host "  Get-Content -Path (adb -s $device2 logcat *:S MyFirebaseMessaging:V IncomingCallActivity:V RingtoneService:V ReactNativeJS:V) | ForEach-Object { Write-Host '[DEVICE2] $_' -ForegroundColor Yellow }" -ForegroundColor Gray
Write-Host ""
Write-Host "IMPORTANT: When testing push notifications:" -ForegroundColor Red
Write-Host "  1. Kill the app on device 2 (swipe away from recent apps)" -ForegroundColor Yellow
Write-Host "  2. Start the log viewer on device 2" -ForegroundColor Yellow
Write-Host "  3. Make a call from device 1 to device 2" -ForegroundColor Yellow
Write-Host "  4. Watch for 'MyFirebaseMessaging' logs showing FCM received" -ForegroundColor Yellow
Write-Host "  5. Watch for 'IncomingCallActivity' logs showing activity launched" -ForegroundColor Yellow
Write-Host "  6. Watch for 'RingtoneService' logs showing ringtone playing" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
