# PlaySocial Release APK Builder
# This script will generate keystore, configure gradle, and build release APK

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PlaySocial Release APK Builder" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$appDir = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $appDir "android"
$appAndroidDir = Join-Path $androidDir "app"
$keystorePath = Join-Path $appAndroidDir "playsocial-release-key.keystore"
$gradlePropsPath = Join-Path $androidDir "gradle.properties"

# Step 1: Check if keystore exists
if (Test-Path $keystorePath) {
    Write-Host "✓ Keystore already exists" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "Step 1: Generating keystore..." -ForegroundColor Yellow
    Write-Host "You will be prompted to enter passwords and information." -ForegroundColor Yellow
    Write-Host ""
    
    Set-Location $appAndroidDir
    
    # Generate keystore with default values
    Write-Host "Enter keystore password (remember this!): " -NoNewline
    $keystorePassword = Read-Host -AsSecureString
    Write-Host "Enter key password (can be same as keystore): " -NoNewline
    $keyPassword = Read-Host -AsSecureString
    Write-Host "Enter your name (or company name) [PlaySocial]: " -NoNewline
    $name = Read-Host
    if ([string]::IsNullOrWhiteSpace($name)) { $name = "PlaySocial" }
    Write-Host "Enter organization unit [Development]: " -NoNewline
    $org = Read-Host
    if ([string]::IsNullOrWhiteSpace($org)) { $org = "Development" }
    Write-Host "Enter organization name [PlaySocial]: " -NoNewline
    $orgName = Read-Host
    if ([string]::IsNullOrWhiteSpace($orgName)) { $orgName = "PlaySocial" }
    Write-Host "Enter city [City]: " -NoNewline
    $city = Read-Host
    if ([string]::IsNullOrWhiteSpace($city)) { $city = "City" }
    Write-Host "Enter state [State]: " -NoNewline
    $state = Read-Host
    if ([string]::IsNullOrWhiteSpace($state)) { $state = "State" }
    Write-Host "Enter country code (2 letters) [US]: " -NoNewline
    $country = Read-Host
    if ([string]::IsNullOrWhiteSpace($country)) { $country = "US" }
    
    # Convert secure strings to plain text for keytool (not ideal but necessary)
    $keystorePassPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($keystorePassword))
    $keyPassPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($keyPassword))
    
    # Create keystore
    $keytoolArgs = @(
        "-genkeypair",
        "-v",
        "-storetype", "PKCS12",
        "-keystore", "playsocial-release-key.keystore",
        "-alias", "playsocial-key-alias",
        "-keyalg", "RSA",
        "-keysize", "2048",
        "-validity", "10000",
        "-storepass", $keystorePassPlain,
        "-keypass", $keyPassPlain,
        "-dname", "CN=$name, OU=$org, O=$orgName, L=$city, ST=$state, C=$country"
    )
    
    & keytool $keytoolArgs
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Keystore created successfully!" -ForegroundColor Green
        Write-Host ""
        
        # Save passwords to gradle.properties
        Write-Host "Step 2: Configuring gradle.properties..." -ForegroundColor Yellow
        
        $gradleContent = Get-Content $gradlePropsPath -Raw
        if ($gradleContent -notmatch "PLAYSOCIAL_RELEASE_STORE_FILE") {
            $gradleContent += "`n# PlaySocial Release Keystore Configuration`n"
            $gradleContent += "PLAYSOCIAL_RELEASE_STORE_FILE=playsocial-release-key.keystore`n"
            $gradleContent += "PLAYSOCIAL_RELEASE_KEY_ALIAS=playsocial-key-alias`n"
            $gradleContent += "PLAYSOCIAL_RELEASE_STORE_PASSWORD=$keystorePassPlain`n"
            $gradleContent += "PLAYSOCIAL_RELEASE_KEY_PASSWORD=$keyPassPlain`n"
            Set-Content -Path $gradlePropsPath -Value $gradleContent
            Write-Host "✓ gradle.properties updated" -ForegroundColor Green
        } else {
            Write-Host "✓ gradle.properties already configured" -ForegroundColor Green
        }
        Write-Host ""
    } else {
        Write-Host "✗ Failed to create keystore" -ForegroundColor Red
        exit 1
    }
}

# Step 3: Build Release APK
Write-Host "Step 3: Building Release APK..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor Yellow
Write-Host ""

Set-Location $androidDir

# Clean previous builds
Write-Host "Cleaning previous builds..." -ForegroundColor Gray
& .\gradlew.bat clean

# Build release APK
Write-Host "Building release APK..." -ForegroundColor Gray
& .\gradlew.bat assembleRelease

if ($LASTEXITCODE -eq 0) {
    $apkPath = Join-Path $appAndroidDir "build\outputs\apk\release\app-release.apk"
    if (Test-Path $apkPath) {
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "✓ Release APK built successfully!" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "APK Location: $apkPath" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "File size: $((Get-Item $apkPath).Length / 1MB) MB" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "You can now install this APK on Android devices!" -ForegroundColor Yellow
    } else {
        Write-Host "✗ APK file not found at expected location" -ForegroundColor Red
    }
} else {
    Write-Host "✗ Build failed. Check the error messages above." -ForegroundColor Red
    exit 1
}
