# PlaySocial Release APK Builder - Simple Version
# Uses default values for keystore generation

$appDir = Split-Path -Parent $PSScriptRoot
$androidDir = $PSScriptRoot
$appAndroidDir = Join-Path $androidDir "app"
$keystorePath = Join-Path $appAndroidDir "playsocial-release-key.keystore"
$gradlePropsPath = Join-Path $androidDir "gradle.properties"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PlaySocial Release APK Builder" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Generate keystore if it doesn't exist
if (Test-Path $keystorePath) {
    Write-Host "✓ Keystore already exists" -ForegroundColor Green
} else {
    Write-Host "Generating keystore with default values..." -ForegroundColor Yellow
    Write-Host "Using default password: playsocial123" -ForegroundColor Yellow
    Write-Host ""
    
    Set-Location $appAndroidDir
    
    # Generate keystore with default values
    $storePass = "playsocial123"
    $keyPass = "playsocial123"
    
    $dname = "CN=PlaySocial, OU=Development, O=PlaySocial, L=City, ST=State, C=US"
    
    & keytool -genkeypair -v -storetype PKCS12 `
        -keystore "playsocial-release-key.keystore" `
        -alias "playsocial-key-alias" `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass $storePass -keypass $keyPass `
        -dname $dname
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Keystore created!" -ForegroundColor Green
        
        # Update gradle.properties
        $gradleContent = Get-Content $gradlePropsPath -Raw -ErrorAction SilentlyContinue
        if ($null -eq $gradleContent) { $gradleContent = "" }
        
        if ($gradleContent -notmatch "PLAYSOCIAL_RELEASE_STORE_FILE") {
            $gradleContent += "`n# PlaySocial Release Keystore Configuration`n"
            $gradleContent += "PLAYSOCIAL_RELEASE_STORE_FILE=playsocial-release-key.keystore`n"
            $gradleContent += "PLAYSOCIAL_RELEASE_KEY_ALIAS=playsocial-key-alias`n"
            $gradleContent += "PLAYSOCIAL_RELEASE_STORE_PASSWORD=$storePass`n"
            $gradleContent += "PLAYSOCIAL_RELEASE_KEY_PASSWORD=$keyPass`n"
            Set-Content -Path $gradlePropsPath -Value $gradleContent
            Write-Host "✓ gradle.properties configured" -ForegroundColor Green
        }
    } else {
        Write-Host "✗ Failed to create keystore" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

# Step 2: Build Release APK
Write-Host "Building Release APK..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor Gray
Write-Host ""

Set-Location $androidDir

# Clean and build
& .\gradlew.bat clean assembleRelease

if ($LASTEXITCODE -eq 0) {
    $apkPath = Join-Path $appAndroidDir "build\outputs\apk\release\app-release.apk"
    if (Test-Path $apkPath) {
        $fileSize = [math]::Round((Get-Item $apkPath).Length / 1MB, 2)
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "✓ Release APK built successfully!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "APK Location: $apkPath" -ForegroundColor Cyan
        Write-Host "File size: $fileSize MB" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Default keystore password: playsocial123" -ForegroundColor Yellow
        Write-Host "IMPORTANT: Change this password for production!" -ForegroundColor Yellow
    } else {
        Write-Host "✗ APK not found" -ForegroundColor Red
    }
} else {
    Write-Host "✗ Build failed" -ForegroundColor Red
    exit 1
}
