# View FCM logs from Neyma's phone (receiver with app killed)
# Use: .\view-fcm-neyma-phone.ps1 [device_id]
# If no device_id provided, will use first device

param(
    [string]$DeviceId = ""
)

Write-Host "`nFCM Logcat for Neyma's Phone (Receiver)`n" -ForegroundColor Cyan

# List devices if no device ID provided
if ($DeviceId -eq "") {
    Write-Host "Available devices:" -ForegroundColor Yellow
    adb devices
    Write-Host "`nUsage: .\view-fcm-neyma-phone.ps1 <device_id>" -ForegroundColor Yellow
    Write-Host "Example: .\view-fcm-neyma-phone.ps1 129065548A000773`n" -ForegroundColor White
    exit
}

Write-Host "Filtering for:" -ForegroundColor Yellow
Write-Host "  - MyFirebaseMessaging" -ForegroundColor White
Write-Host "  - FCM" -ForegroundColor White
Write-Host "  - onMessageReceived" -ForegroundColor White
Write-Host "  - IncomingCallActivity" -ForegroundColor White
Write-Host "  - RingtoneService" -ForegroundColor White
Write-Host "  - call_ended" -ForegroundColor White
Write-Host "  - incoming_call`n" -ForegroundColor White

Write-Host "Starting logcat on device: $DeviceId" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop`n" -ForegroundColor Green

# Clear logcat buffer first
adb -s $DeviceId logcat -c

# Start logcat with filters
adb -s $DeviceId logcat *:S MyFirebaseMessaging:V GCM:V | Select-String -Pattern "MyFirebaseMessaging|FCM|onMessageReceived|IncomingCallActivity|RingtoneService|call_ended|incoming_call|MESSAGING_EVENT|c2dm" -CaseSensitive:$false
