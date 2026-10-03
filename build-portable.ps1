param(
    [switch]$Zip,
    [switch]$NoPause
)

# ========================================================================
# PuffFile - 單檔免安裝版 (Portable) 自動建置與打包
#
# 產出：dist-portable\PuffFile.exe —— 一個檔案就是整套程式。
#   * 前端（Vite 產物）由 tauri-build 內嵌進執行檔
#   * 應用程式圖示內嵌在執行檔的資源區
#   * MSVC 工具鏈以靜態方式連結 WebView2 載入器，不需要任何外部 DLL
# 因此不需要安裝精靈、不需要管理員權限，複製到任何 Windows 10/11 都能直接跑
# （唯一的前提是系統要有 WebView2 Runtime，Windows 11 與已更新的 Windows 10 內建）。
#
# 用法：
#   .\build-portable.ps1            只產出單一執行檔
#   .\build-portable.ps1 -Zip       另外產生 PuffFile-Portable.zip
#   .\build-portable.ps1 -NoPause   結束不等待按鍵（給自動化使用）
#
# 編碼規範：UTF-8 with BOM (相容 Windows PowerShell 5.1 與 PowerShell 7+)
# ========================================================================

# 強制設定主控台與管線字元編碼為 UTF-8，徹底杜絕 Windows 終端亂碼
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 >$null 2>&1

$Host.UI.RawUI.WindowTitle = "PuffFile - 單檔免安裝版打包程式"

# 確保工作目錄為當前指令碼所在目錄
Set-Location -LiteralPath $PSScriptRoot

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  PuffFile - 單檔免安裝版 (Portable) 自動建置與打包" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""

function Stop-Script ($msg) {
    Write-Host ""
    Write-Host "[錯誤] $msg" -ForegroundColor Red
    if (-not $NoPause) {
        Read-Host "按 Enter 鍵結束..."
    }
    exit 1
}

function Test-CommandAvailable ($cmd) {
    return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

# ------------------------------------------------------------------------
# 1/4 檢查系統編譯環境 (Node.js, npm, Rust/Cargo)
# ------------------------------------------------------------------------
Write-Host "[1/4] 正在檢查系統編譯環境..." -ForegroundColor Yellow

if (-not (Test-CommandAvailable "node")) {
    Stop-Script "找不到 Node.js，請確認已安裝 Node.js 並設定環境變數 PATH。"
}

if (-not (Test-CommandAvailable "npm")) {
    Stop-Script "找不到 npm，請確認已安裝 npm 並設定環境變數 PATH。"
}

if (-not (Test-CommandAvailable "cargo")) {
    Stop-Script "找不到 Rust / Cargo，請確認已安裝 Rust 並設定環境變數 PATH。"
}

Write-Host "  - Node.js: OK ($(node --version))" -ForegroundColor Green
Write-Host "  - npm:     OK (v$(npm --version))" -ForegroundColor Green
Write-Host "  - Cargo:   OK ($(cargo --version))" -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------------------
# 2/4 準備輸出目錄
# ------------------------------------------------------------------------
Write-Host "[2/4] 準備輸出目錄 (dist-portable)..." -ForegroundColor Yellow
$OutDir = Join-Path $PSScriptRoot "dist-portable"
if (-not (Test-Path -LiteralPath $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}
Write-Host "  - 輸出路徑: $OutDir" -ForegroundColor Gray

# 清掉上一次的產物，避免使用者拿到舊的執行檔
$StaleArtifacts = @(
    (Join-Path $OutDir "PuffFile.exe"),
    (Join-Path $OutDir "puff-file.exe"),
    (Join-Path $OutDir "WebView2Loader.dll"),
    (Join-Path $OutDir "PuffFile-Portable.zip")
)
foreach ($StalePath in $StaleArtifacts) {
    if (Test-Path -LiteralPath $StalePath) {
        Remove-Item -LiteralPath $StalePath -Force
        Write-Host "  - 已移除舊產物: $(Split-Path $StalePath -Leaf)" -ForegroundColor DarkGray
    }
}
Write-Host ""

# ------------------------------------------------------------------------
# 3/4 建置單檔免安裝程式（--no-bundle：跳過 MSI / NSIS 安裝包）
# ------------------------------------------------------------------------
Write-Host "[3/4] 開始建置單檔免安裝程式 (Frontend + Rust Core)..." -ForegroundColor Yellow
Write-Host "  - 執行: npm run build:portable" -ForegroundColor Gray
Write-Host "  - 請稍候，正在進行前端打包與 Rust release 最佳化編譯 (LTO，第一次會慢一些)..." -ForegroundColor Gray
Write-Host ""

& npm run build:portable
if ($LASTEXITCODE -ne 0) {
    Stop-Script "建置過程失敗，請檢查上方編譯紀錄。"
}
Write-Host ""

# ------------------------------------------------------------------------
# 4/4 匯出單一執行檔
# ------------------------------------------------------------------------
Write-Host "[4/4] 正在匯出單一執行檔..." -ForegroundColor Yellow

$CandidateExes = @(
    "$PSScriptRoot\src-tauri\target\release\puff-file.exe",
    "$PSScriptRoot\src-tauri\target\release\PuffFile.exe",
    "$PSScriptRoot\src-tauri\target\x86_64-pc-windows-msvc\release\puff-file.exe",
    "$PSScriptRoot\src-tauri\target\x86_64-pc-windows-msvc\release\PuffFile.exe"
)

$ExistingExes = @($CandidateExes | Where-Object { Test-Path -LiteralPath $_ } | Get-Item | Sort-Object LastWriteTime -Descending)
if ($ExistingExes.Count -eq 0) {
    Stop-Script "找不到編譯後的執行檔，請檢查 src-tauri\target\release\ 目錄。"
}

$ExeSrc = $ExistingExes[0].FullName
$TargetExe = Join-Path $OutDir "PuffFile.exe"
Copy-Item -LiteralPath $ExeSrc -Destination $TargetExe -Force
Write-Host "  - 已匯出主程式: $TargetExe" -ForegroundColor Green
Write-Host "  - 來源: $ExeSrc" -ForegroundColor DarkGray

# 單檔的前提是沒有外部相依；MSVC 靜態連結應該不會產出這顆 DLL，若真的出現就要說清楚。
$ExeDir = Split-Path $ExeSrc
$HasDll = $false
if (Test-Path -LiteralPath (Join-Path $ExeDir "WebView2Loader.dll")) {
    Copy-Item -LiteralPath (Join-Path $ExeDir "WebView2Loader.dll") -Destination (Join-Path $OutDir "WebView2Loader.dll") -Force
    $HasDll = $true
    Write-Host "  - [警告] 這一版的工具鏈會另外產生 WebView2Loader.dll，輸出不是單一檔案。" -ForegroundColor Red
    Write-Host "    執行檔必須與這顆 DLL 放在同一個資料夾才能啟動。" -ForegroundColor Red
}
else {
    Write-Host "  - 沒有外部相依 DLL，確認是單一檔案。" -ForegroundColor Green
}
Write-Host ""

# 選用：壓縮成一個 zip，方便分享（單檔本身不需要解壓縮就能執行）
$ZipPath = Join-Path $OutDir "PuffFile-Portable.zip"
if ($Zip) {
    Write-Host "正在打包可攜版壓縮檔..." -ForegroundColor Yellow
    if (Test-Path -LiteralPath $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
    }
    $ItemsToZip = @($TargetExe)
    if ($HasDll) {
        $ItemsToZip += (Join-Path $OutDir "WebView2Loader.dll")
    }
    Compress-Archive -LiteralPath $ItemsToZip -DestinationPath $ZipPath -Force
    if (Test-Path -LiteralPath $ZipPath) {
        Write-Host "  - 壓縮檔建立成功: $ZipPath" -ForegroundColor Green
    }
    Write-Host ""
}

# ------------------------------------------------------------------------
# 完成資訊與大小摘要
# ------------------------------------------------------------------------
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  [完成] PuffFile 單檔免安裝版已打包成功！" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

$ExeItem = Get-Item -LiteralPath $TargetExe
$ExeSizeMB = [math]::Round($ExeItem.Length / 1MB, 2)
Write-Host "  執行檔:   $TargetExe" -ForegroundColor White
Write-Host "  檔案大小: $ExeSizeMB MB ($($ExeItem.Length.ToString('N0')) bytes)" -ForegroundColor Gray

if (Test-Path -LiteralPath $ZipPath) {
    $ZipItem = Get-Item -LiteralPath $ZipPath
    $ZipSizeMB = [math]::Round($ZipItem.Length / 1MB, 2)
    Write-Host "  壓縮檔:   $ZipPath" -ForegroundColor Green
    Write-Host "  壓縮大小: $ZipSizeMB MB ($($ZipItem.Length.ToString('N0')) bytes)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "  【使用說明】" -ForegroundColor Yellow
Write-Host "  1. 綠色免安裝：不需要安裝精靈、不需要管理員權限。" -ForegroundColor White
if ($HasDll) {
    Write-Host "  2. 這個版本不是單一檔案：PuffFile.exe 必須與 WebView2Loader.dll 放在一起。" -ForegroundColor Red
}
else {
    Write-Host "  2. 單一檔案：把 PuffFile.exe 複製到任何 Windows 10/11 電腦或隨身碟即可執行。" -ForegroundColor Green
}
Write-Host "  3. 需要系統的 WebView2 Runtime（Windows 11 內建；Windows 10 多半已隨 Edge 更新安裝）。" -ForegroundColor White
Write-Host "  4. 設定與瀏覽紀錄存在使用者設定檔（%LOCALAPPDATA%），不會跟著執行檔移動。" -ForegroundColor White
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""

if (-not $NoPause) {
    # 開啟輸出資料夾並反白選取該執行檔
    Start-Process explorer.exe -ArgumentList "/select,`"$TargetExe`""
    Read-Host "按 Enter 鍵結束..."
}
