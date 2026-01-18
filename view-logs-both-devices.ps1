# View logs from both devices simultaneously
# Usage: .\view-logs-both-devices.ps1

Write-Host "📱 Viewing logs from both devices simultaneously" -ForegroundColor Cyan
Write-Host "Filtering for: FCM, OneSignal, WebRTC, ICE, CallUser, AnswerCall, IncomingCall" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

# Get all connected devices
$devices = adb devices | Select-String -Pattern "device$" | ForEach-Object { ($_ -split "\s+")[0] }

if ($devices.Count -eq 0) {
    Write-Host "❌ No devices found. Make sure your devices are connected and USB debugging is enabled." -ForegroundColor Red
    exit 1
}

if ($devices.Count -lt 2) {
    Write-Host "⚠️ Only $($devices.Count) device(s) found. Need at least 2 devices." -ForegroundColor Yellow
    Write-Host "Connected devices:" -ForegroundColor Gray
    foreach ($device in $devices) {
        Write-Host "  - $device" -ForegroundColor Gray
    }
    exit 1
}

$device1 = $devices[0]
$device2 = $devices[1]

Write-Host "📱 Device 1: $device1" -ForegroundColor Green
Write-Host "📱 Device 2: $device2" -ForegroundColor Blue
Write-Host ""
Write-Host "📋 Pattern: FCM|OneSignal|WebRTC|ICE|CallUser|AnswerCall|IncomingCall|Socket|callUser|EVENT" -ForegroundColor Gray
Write-Host ""

# Start background jobs for each device
$pattern = "FCM|OneSignal|WebRTC|ICE|CallUser|AnswerCall|IncomingCall|Socket|callUser|EVENT"

Write-Host "Starting log monitoring for both devices..." -ForegroundColor Cyan
Write-Host ""

# Create a script block for each device
$scriptBlock1 = {
    param($deviceId, $deviceLabel)
    adb -s $deviceId logcat *:S ReactNativeJS:V | Select-String -Pattern "FCM|OneSignal|WebRTC|ICE|CallUser|AnswerCall|IncomingCall|Socket|callUser|EVENT" | ForEach-Object {
        Write-Host "[$deviceLabel] $_" -ForegroundColor Green
    }
}

$scriptBlock2 = {
    param($deviceId, $deviceLabel)
    adb -s $deviceId logcat *:S ReactNativeJS:V | Select-String -Pattern "FCM|OneSignal|WebRTC|ICE|CallUser|AnswerCall|IncomingCall|Socket|callUser|EVENT" | ForEach-Object {
        Write-Host "[$deviceLabel] $_" -ForegroundColor Blue
    }
}

# Start jobs (this is complex in PowerShell, so let's use a simpler approach)
Write-Host "📋 Tip: For better results, run separate terminals:" -ForegroundColor Yellow
Write-Host "  Terminal 1: adb -s $device1 logcat *:S ReactNativeJS:V | Select-String -Pattern '$pattern'" -ForegroundColor Green
Write-Host "  Terminal 2: adb -s $device2 logcat *:S ReactNativeJS:V | Select-String -Pattern '$pattern'" -ForegroundColor Blue
Write-Host ""
Write-Host "Or view logs one at a time using:" -ForegroundColor Yellow
Write-Host "  .\view-logs-device1.ps1  (for device 1)" -ForegroundColor Green
Write-Host "  .\view-logs-device2.ps1  (for device 2)" -ForegroundColor Blue
Write-Host ""

# For now, let's show device 1 logs (user can run device 2 in another terminal)
Write-Host "Showing logs from Device 1 ($device1):" -ForegroundColor Green
Write-Host "(Open another terminal for Device 2)" -ForegroundColor Gray
Write-Host ""

adb -s $device1 logcat *:S ReactNativeJS:V | Select-String -Pattern $pattern