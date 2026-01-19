# View cancel call logs from both devices
Write-Host "`n=== Clearing logs and starting monitoring ===" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop`n" -ForegroundColor Yellow

# Clear logs on both devices
adb -s 129065548A000773 logcat -c
adb -s R8YW501N1RW logcat -c

Write-Host "`n=== Device 1 (Receiver - declining) ===" -ForegroundColor Green
Write-Host "Looking for: Decline button, SharedPreferences, cancelCall emission`n" -ForegroundColor Gray

# Start monitoring device 1 (receiver) in background
Start-Job -ScriptBlock {
    adb -s 129065548A000773 logcat | Select-String -Pattern "WebRTC|IncomingCallActivity|AppNavigator|cancelCall|PENDING|SharedPreferences|Decline"
} | Out-Null

Write-Host "=== Device 2 (Caller - should receive cancel) ===" -ForegroundColor Green
Write-Host "Looking for: CALL CANCELED received`n" -ForegroundColor Gray

# Monitor device 2 (caller) in foreground
adb -s R8YW501N1RW logcat | Select-String -Pattern "WebRTC|CALL CANCELED|CallCanceled|cancelCall|Connection.*closed"
