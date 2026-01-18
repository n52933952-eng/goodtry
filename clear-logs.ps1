# Clear logs on both devices
Write-Host "Clearing logs on Device 1..." -ForegroundColor Yellow
adb -s 129065548A000773 logcat -c
Write-Host "Clearing logs on Device 2..." -ForegroundColor Yellow
adb -s R8YW501N1RW logcat -c
Write-Host "Logs cleared!" -ForegroundColor Green
