# Filter logs for Decline button press and cancel flow
# This will show logs from IncomingCallActivity, WebRTCContext, and socket events

$deviceId = "129065548A000773"

Write-Host ""
Write-Host "Filtering logs for Decline/Cancel flow..." -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Decline button on the receiver device, then check the logs below:" -ForegroundColor Yellow
Write-Host ""
Write-Host "This will show:" -ForegroundColor White
Write-Host "  - IncomingCallActivity logs (when Decline is pressed)" -ForegroundColor Gray
Write-Host "  - WebRTCContext logs (checking SharedPreferences, emitting cancelCall)" -ForegroundColor Gray
Write-Host "  - Socket logs (cancelCall event emission)" -ForegroundColor Gray
Write-Host ""

# Clear logcat first
adb -s $deviceId logcat -c

# Filter for our app's logs related to Decline/Cancel
$pattern = 'DECLINE|Decline|decline|CANCEL|Cancel|cancel|SharedPreferences|PENDING|pendingCancel|cancelCall|CallCanceled|WebRTC|IncomingCallActivity|MainActivity|Checking|PENDING CANCEL|Emitting'

adb -s $deviceId logcat *:S IncomingCallActivity:E MainActivity:E ReactNativeJS:V RingtoneService:E MyFirebaseMessagingService:E | Select-String -Pattern $pattern -Context 0,3
