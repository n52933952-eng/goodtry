# View FCM logs from both phones
# Shows available devices and usage

Write-Host "`nAvailable Devices:`n" -ForegroundColor Cyan
adb devices

Write-Host "`nTo view FCM logs, use one of these commands:`n" -ForegroundColor Yellow

Write-Host "For Device 1 (129065548A000773):" -ForegroundColor Green
Write-Host "  adb -s 129065548A000773 logcat -c" -ForegroundColor White
Write-Host "  adb -s 129065548A000773 logcat *:S MyFirebaseMessaging:V GCM:V | Select-String -Pattern 'MyFirebaseMessaging|FCM|onMessageReceived|IncomingCallActivity|RingtoneService|call_ended|incoming_call'`n" -ForegroundColor White

Write-Host "For Device 2 (R8YW501N1RW):" -ForegroundColor Green
Write-Host "  adb -s R8YW501N1RW logcat -c" -ForegroundColor White
Write-Host "  adb -s R8YW501N1RW logcat *:S MyFirebaseMessaging:V GCM:V | Select-String -Pattern 'MyFirebaseMessaging|FCM|onMessageReceived|IncomingCallActivity|RingtoneService|call_ended|incoming_call'`n" -ForegroundColor White

Write-Host "OR use the script:" -ForegroundColor Yellow
Write-Host "  .\view-fcm-neyma-phone.ps1 129065548A000773" -ForegroundColor White
Write-Host "  .\view-fcm-neyma-phone.ps1 R8YW501N1RW`n" -ForegroundColor White
