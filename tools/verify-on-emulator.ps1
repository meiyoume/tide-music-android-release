<#
  在 Android 模拟器上验证「鸿蒙移植版」真的能跑起来，并留下截图。

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\verify-on-emulator.ps1 `
      -Avd lx_phone -Tag phone `
      -Apk android\app\build\outputs\apk\release\lx-music-mobile-v1.9.1-harmony-x86_64.apk

  ⚠️ 一个必须知道的坑（2026-10-07 实测踩过）：
    本移植版的 applicationId 是 `cn.toside.music.mobile.harmony`，
    但 Activity 的**类名**仍是 `cn.toside.music.mobile.MainActivity`（namespace 没改）。
    所以 `adb shell am start -n cn.toside.music.mobile/cn.toside.music.mobile.MainActivity`
    启动的是**applicationId 为 cn.toside.music.mobile 的那个应用**——如果模拟器上还留着
    早期版本的移植包（那时 applicationId 还没改），就会启动到那个旧包，
    看到的界面是旧外观，会让人误以为「新构建没生效」。
    ⇒ 本脚本先 `adb uninstall cn.toside.music.mobile`，再用 **.harmony** 组件名启动。
#>
param(
  [string]$Avd = 'lx_phone',
  [Parameter(Mandatory=$true)][string]$Tag,
  [Parameter(Mandatory=$true)][string]$Apk,
  [int]$Memory = 3072,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Continue'

$sdk = $env:ANDROID_SDK_ROOT
if (-not $sdk) { $sdk = 'D:\android-tools\sdk' }
$adb = Join-Path $sdk 'platform-tools\adb.exe'
$emu = Join-Path $sdk 'emulator\emulator.exe'

$pkg = 'cn.toside.music.mobile.harmony'
$act = "$pkg/cn.toside.music.mobile.MainActivity"
$legacyPkg = 'cn.toside.music.mobile'

$repo = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$out = Join-Path $repo 'shots\verify'
if (-not (Test-Path $out)) { New-Item -ItemType Directory -Path $out | Out-Null }

function Log($m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) }
function Shot($name) {
  & $adb shell screencap -p /sdcard/$name.png | Out-Null
  & $adb pull /sdcard/$name.png (Join-Path $out "$name.png") | Out-Null
  Log "screenshot -> $(Join-Path $out "$name.png")"
}

& $adb emu kill 2>$null | Out-Null
Start-Sleep -Seconds 3

Log "start emulator $Avd"
Start-Process -FilePath $emu -PassThru -ArgumentList @(
  '-avd', $Avd, '-no-snapshot', '-no-audio', '-no-boot-anim',
  '-gpu', 'swiftshader_indirect', '-no-window', '-memory', "$Memory"
) -RedirectStandardOutput (Join-Path $out "_emu-$Tag.out.log") -RedirectStandardError (Join-Path $out "_emu-$Tag.err.log") | Out-Null

& $adb wait-for-device
$deadline = (Get-Date).AddSeconds(300)
$booted = $false
while ((Get-Date) -lt $deadline) {
  $bc = (& $adb shell getprop sys.boot_completed 2>$null) -join ''
  if ($bc.Trim() -eq '1') { $booted = $true; break }
  Start-Sleep -Seconds 5
}
Log "boot_completed = $booted"
if (-not $booted) { & $adb emu kill 2>$null | Out-Null; exit 2 }
Start-Sleep -Seconds 8

& $adb shell cmd uimode night no 2>$null | Out-Null
& $adb shell settings put global window_animation_scale 0 | Out-Null
& $adb shell settings put global transition_animation_scale 0 | Out-Null
& $adb shell settings put global animator_duration_scale 0 | Out-Null

Log "installed packages before cleanup:"
& $adb shell pm list packages | Select-String -Pattern 'cn\.toside' | ForEach-Object { Log "  $($_.Line)" }

if (-not $SkipInstall) {
  # 先卸掉 applicationId 还是 cn.toside.music.mobile 的历史（旧）移植包
  & $adb uninstall $legacyPkg 2>$null | Out-Null
  & $adb install -r -g $Apk
  Log "install exit = $LASTEXITCODE"
}

& $adb shell am force-stop $pkg
& $adb shell am start -n $act | Out-Null
Start-Sleep -Seconds 25

Log 'dismiss first-run dialogs'
for ($i = 1; $i -le 8; $i++) {
  $r = & node (Join-Path $repo 'tools\dismiss-first-run.mjs') 2>&1
  Log "  [$i] $r"
  if ("$r" -match 'NO_DIALOG') { break }
  Start-Sleep -Seconds 3
}
Start-Sleep -Seconds 3

Shot "$Tag-01-home"

Log 'switch to the "mine" tab (node text 我的) and screenshot'
& node (Join-Path $repo 'tools\ui-probe.mjs') taphex e68891e79a84 2>&1 |
  Select-String -Pattern 'found|NOT FOUND|visible texts' | ForEach-Object { Log "  $($_.Line)" }
Shot "$Tag-02-mine"

Log 'state'
& $adb shell wm size    | ForEach-Object { Log "  wm size: $($_.Trim())" }
& $adb shell wm density | ForEach-Object { Log "  wm density: $($_.Trim())" }
& $adb shell dumpsys window 2>$null | Select-String -Pattern 'mCurrentFocus' | Select-Object -First 1 | ForEach-Object { Log "  focus: $($_.Line.Trim())" }
$crash = & $adb logcat -d -v brief | Select-String -Pattern 'FATAL EXCEPTION|AndroidRuntime: Process'
if ($crash) { Log 'CRASH:'; $crash | ForEach-Object { Log "  $($_.Line)" } } else { Log '  no fatal exception in logcat' }

& $adb emu kill 2>$null | Out-Null
Start-Sleep -Seconds 3
Log 'DONE'
