# View push notification logs for device 1
# Usage: .\view-push-logs.ps1

$DEVICE_ID = "129065548A000773"

Write-Host "Viewing push notification logs for device: $DEVICE_ID" -ForegroundColor Cyan
Write-Host "Filtering for: FCM, OneSignal, Push, Notification, Firebase" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

$pattern = "FCM|OneSignal|Push|Notification|Firebase|messaging|Token|incoming_call|call_ended|background|foreground"
adb -s $DEVICE_ID logcat *:S ReactNativeJS:V | Select-String -Pattern $pattern