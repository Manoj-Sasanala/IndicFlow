# ==============================================================================
# Setup Offline Speech Engine for IndicFlow
# Downloads pre-built Windows x64 engine binary and compact ggml-base model (~140MB)
# ==============================================================================

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $scriptDir
$engineDir = Join-Path $appDir "native\local-engine"

Write-Host ">>> IndicFlow Local Engine Setup" -ForegroundColor Cyan
Write-Host "Target directory: $engineDir" -ForegroundColor Gray

if (-not (Test-Path $engineDir)) {
    New-Item -ItemType Directory -Path $engineDir -Force | Out-Null
}

# 1. Check / Download Model (ggml-small.en.bin or ggml-base.en.bin)
$smallModel = Join-Path $engineDir "ggml-small.en.bin"
$baseModel = Join-Path $engineDir "ggml-base.en.bin"

if (Test-Path $smallModel) {
    Write-Host "`n[1/2] Optimal high-accuracy model detected: ggml-small.en.bin (466 MB)" -ForegroundColor Green
    $modelFile = $smallModel
} elseif (Test-Path $baseModel) {
    Write-Host "`n[1/2] Fast base model detected: ggml-base.en.bin (141 MB)" -ForegroundColor Green
    $modelFile = $baseModel
} else {
    Write-Host "`n[1/2] Downloading ggml-small.en.bin model (466 MB)..." -ForegroundColor Yellow
    $modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
    Invoke-WebRequest -Uri $modelUrl -OutFile $smallModel -UseBasicParsing
    Write-Host "  ✔ Model downloaded successfully: $smallModel" -ForegroundColor Green
    $modelFile = $smallModel
}

# 2. Download Engine Binary for Windows x64
$exeFile = Join-Path $engineDir "whisper-cli.exe"
if (-not (Test-Path $exeFile)) {
    $altExe = Join-Path $engineDir "main.exe"
    if (Test-Path $altExe) {
        Copy-Item $altExe $exeFile
    }
}

if (-not (Test-Path $exeFile)) {
    Write-Host "`n[2/2] Downloading pre-compiled engine Windows x64 release..." -ForegroundColor Yellow
    $zipUrl = "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip"
    $zipFile = Join-Path $engineDir "engine-bin-x64.zip"
    
    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile -UseBasicParsing
        Expand-Archive -Path $zipFile -DestinationPath $engineDir -Force
        Remove-Item $zipFile -Force -ErrorAction SilentlyContinue

        if (Test-Path (Join-Path $engineDir "main.exe") -and -not (Test-Path $exeFile)) {
            Copy-Item (Join-Path $engineDir "main.exe") $exeFile
        }
        Write-Host "  ✔ Engine Windows binaries installed successfully!" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠ Note: Direct zip download failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
        Write-Host "  You can place any 'whisper-cli.exe' or 'main.exe' and 'ggml-base.en.bin' in '$engineDir'" -ForegroundColor Gray
    }
} else {
    Write-Host "`n[2/2] Binary already exists." -ForegroundColor Green
}

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host " Local Engine is ready!" -ForegroundColor Green
Write-Host " Binary: $exeFile" -ForegroundColor Gray
Write-Host " Model:  $modelFile" -ForegroundColor Gray
Write-Host "==================================================================" -ForegroundColor Cyan
