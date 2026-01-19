# Debug Answer button in notification
# Usage: .\view-answer-button-debug.ps1

param(
    [string]$DeviceId = "129065548A000773"
)

Write-Host "🔍 Debugging Answer Button in Notification" -ForegroundColor Cyan
Write-Host "Device: $DeviceId" -ForegroundColor Yellow
Write-Host ""
Write-Host "Watching for:" -ForegroundColor Green
Write-Host "  - CallActionReceiver logs" -ForegroundColor White
Write-Host "  - MainActivity logs" -ForegroundColor White
Write-Host "  - Answer/Decline actions" -ForegroundColor White
Write-Host "  - shouldAutoAnswer" -ForegroundColor White
Write-Host ""
Write-Host "Press Answer button now and watch the logs..." -ForegroundColor Yellow
Write-Host ""

# Clear log buffer first
adb -s $DeviceId logcat -c

# Start viewing logs with specific tags
adb -s $DeviceId logcat *:S CallActionReceiver:V MainActivity:V MyFirebaseMessaging:V IncomingCallActivity:V RingtoneService:V ReactNativeJS:V
