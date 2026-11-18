# Build both ABIs and keep BOTH outputs.
#
# Why this exists: Gradle keeps only the release output of the LAST
# -PreactNativeArchitectures it was invoked with, so building arm64 after x86_64
# silently deletes the x86_64 APK. This script copies each build out of the way
# before starting the next one.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-both.ps1
#
# NOTE: keep this file pure ASCII (Windows PowerShell 5.1 reads .ps1 as the ANSI code page).

$ErrorActionPreference = 'Continue'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$releaseDir = Join-Path $root 'android\app\build\outputs\apk\release'
$staging = Join-Path $root 'build-staging'
New-Item -ItemType Directory -Path $staging -Force | Out-Null

foreach ($abi in @('x86_64', 'arm64-v8a')) {
  Write-Host "===== building $abi ====="
  & powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\android-tools\build-android.ps1' $abi assembleRelease
  if ($LASTEXITCODE -ne 0) { Write-Host "build failed: $abi"; exit 1 }

  $apk = Get-ChildItem $releaseDir -Filter "*harmony-$abi.apk" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $apk) { Write-Host "no apk produced for $abi"; exit 1 }

  $dest = Join-Path $staging $apk.Name
  Copy-Item $apk.FullName $dest -Force
  $hash = (Get-FileHash $dest -Algorithm SHA256).Hash
  Write-Host ("saved {0}  {1} MB  sha256 {2}" -f $apk.Name, [math]::Round($apk.Length / 1MB, 2), $hash)
}

Write-Host ''
Write-Host "staged in $staging"
Get-ChildItem $staging -Filter *.apk | ForEach-Object {
  Write-Host ("  {0}  {1} MB" -f $_.Name, [math]::Round($_.Length / 1MB, 2))
}
