# View call-related logs
# Usage: .\view-call-logs.ps1

Write-Host "📞 Call Logs Viewer" -ForegroundColor Cyan
Write-Host ""

# Option 1: ActivityManager only
Write-Host "1. ActivityManager logs:" -ForegroundColor Yellow
Write-Host "   adb logcat *:S ActivityManager:V" -ForegroundColor White
Write-Host ""

# Option 2: All call-related logs
Write-Host "2. All call-related logs (recommended):" -ForegroundColor Yellow
Write-Host "   adb logcat *:S | Select-String -Pattern 'MyFirebaseMessaging|IncomingCallActivity|CallActionReceiver|RingtoneService|MainActivity|ActivityManager|ReactNativeJS'" -ForegroundColor White
Write-Host ""

# Option 3: FCM and push notification logs
Write-Host "3. FCM and push notification logs:" -ForegroundColor Yellow
Write-Host "   adb logcat *:S | Select-String -Pattern 'MyFirebaseMessaging|FirebaseMessaging|FCM|CallActionReceiver|IncomingCallActivity'" -ForegroundColor White
Write-Host ""

# Option 4: React Native + call logs
Write-Host "4. React Native + call logs:" -ForegroundColor Yellow
Write-Host "   adb logcat *:S ReactNativeJS:V MyFirebaseMessaging:V IncomingCallActivity:V CallActionReceiver:V MainActivity:V | Select-String -Pattern 'Call|Answer|Decline|Incoming|WebRTC|Socket'" -ForegroundColor White
Write-Host ""

# For multiple devices, get device ID first
Write-Host "5. For specific device (if multiple devices):" -ForegroundColor Yellow
Write-Host "   adb devices" -ForegroundColor White
Write-Host "   adb -s <device_id> logcat *:S ActivityManager:V" -ForegroundColor White
Write-Host ""

# Start the recommended one
Write-Host "Starting all call-related logs..." -ForegroundColor Green
adb logcat *:S | Select-String -Pattern "MyFirebaseMessaging|IncomingCallActivity|CallActionReceiver|RingtoneService|MainActivity|ActivityManager|ReactNativeJS"
