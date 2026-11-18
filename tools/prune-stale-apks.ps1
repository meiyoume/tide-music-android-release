# Move stale APKs in this repo's build dirs to the Recycle Bin, keeping only the current version.
#
# Why: build-staging/ keeps one file per ABI per version (that is the point of
# build-both.ps1), so it grows a new pair every release; and the debug output dir
# keeps whatever the last debug build produced, which can be many versions old.
# The user asked for "only the latest, the old ones are clutter" (same policy as
# prune-desktop-apks.ps1, which covers the Desktop deliverable).
#
# Recycle Bin, not a hard delete: recoverable if we guessed wrong.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\prune-stale-apks.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\prune-stale-apks.ps1 -Version 1.9.13
#
# NOTE: keep this file PURE ASCII. Windows PowerShell 5.1 reads .ps1 as the ANSI
# code page, so Chinese literals get mangled and break -f formatting.

param(
  [string]$Version = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName Microsoft.VisualBasic

$root = Resolve-Path (Join-Path $PSScriptRoot '..')

if (-not $Version) {
  $pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
  $Version = $pkg.version
}
Write-Host ("keeping version: {0}" -f $Version)

# Where APKs pile up. release/ holds only the last gradle invocation's output,
# so it self-prunes; staging/ and debug/ are the ones that accumulate.
$dirs = @(
  (Join-Path $root 'build-staging'),
  (Join-Path $root 'android\app\build\outputs\apk\debug')
)

$recycled = 0
$kept = @()
foreach ($d in $dirs) {
  if (-not (Test-Path $d)) { continue }
  foreach ($f in Get-ChildItem $d -Filter '*.apk') {
    if ($f.Name -like "*-v$Version-*") {
      $kept += $f
      continue
    }
    $mb = [math]::Round($f.Length / 1MB, 1)
    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
      $f.FullName, 'OnlyErrorDialogs', 'SendToRecycleBin')
    Write-Host ("  -> recycle bin: {0}  ({1} MB)" -f $f.Name, $mb)
    $recycled++
  }
}

if ($recycled -eq 0) { Write-Host '  nothing stale' }
Write-Host ''
Write-Host 'left in place:'
foreach ($f in $kept) {
  Write-Host ("  {0}  {1} MB" -f $f.Name, [math]::Round($f.Length / 1MB, 2))
}
