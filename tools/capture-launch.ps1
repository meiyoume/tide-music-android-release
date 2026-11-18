# Capture the frames of the app launch.
#
# Why not screenrecord: there is no ffmpeg on this machine, so mp4 cannot be decoded.
# A device-side screencap loop writing to /sdcard avoids the per-frame adb round trip,
# giving roughly 4-6 fps - enough to catch the few-hundred-ms flash during launch.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\capture-launch.ps1 [frames] [delayMs]
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 as the ANSI code page
# (GBK here), so non-ASCII characters get mangled and break string literals.

param(
  [int]$Frames = 30,
  [int]$DelayMs = 500
)

$ErrorActionPreference = 'Stop'
$adb = 'D:\android-tools\sdk\platform-tools\adb.exe'
$pkg = 'cn.toside.music.mobile.harmony'
$outDir = Join-Path $PSScriptRoot '..\shots\launch'

if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

Write-Host "[1/4] force-stop and clear old frames"
& $adb shell am force-stop $pkg | Out-Null
& $adb shell rm -f /sdcard/fl_*.png | Out-Null

Write-Host "[2/4] start capture loop ($Frames frames)"
$devCmd = "i=0; while [ `$i -lt $Frames ]; do screencap -p /sdcard/fl_`$i.png; i=`$((i+1)); done; echo CAPTURE_DONE"
$job = Start-Job -ScriptBlock {
  param($adb, $cmd)
  & $adb shell $cmd 2>&1
} -ArgumentList $adb, $devCmd

Start-Sleep -Milliseconds $DelayMs

Write-Host "[3/4] launch app"
& $adb shell monkey -p $pkg -c android.intent.category.LAUNCHER 1 | Out-Null

Wait-Job $job -Timeout 90 | Out-Null
Receive-Job $job | Out-Null
Remove-Job $job -Force

Write-Host "[4/4] pull frames"
# adb writes progress to stderr; with ErrorActionPreference=Stop that surfaces as a
# terminating NativeCommandError, so relax it for the pull loop only.
$ErrorActionPreference = 'Continue'
for ($i = 0; $i -lt $Frames; $i++) {
  $src = "/sdcard/fl_$i.png"
  $dst = Join-Path $outDir ("fl_{0:D2}.png" -f $i)
  & $adb pull $src $dst 2>&1 | Out-Null
}
& $adb shell rm -f /sdcard/fl_*.png | Out-Null

$got = (Get-ChildItem $outDir -Filter *.png).Count
Write-Host "done: $got frames in $outDir"
