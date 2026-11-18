# Screenshot the device, then make a downscaled copy for reading.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools\shot.ps1 -Name charts
# Produces: shots/live/charts.png (full res) and shots/live/charts.small.png (540px wide)
#
# NOTE: keep this file pure ASCII (Windows PowerShell 5.1 reads .ps1 as the ANSI code page).

param(
  [Parameter(Mandatory = $true)][string]$Name,
  [int]$SmallWidth = 540
)

$ErrorActionPreference = 'Continue'
$adb = 'D:\android-tools\sdk\platform-tools\adb.exe'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$outDir = Join-Path $root 'shots\live'
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$dst = Join-Path $outDir "$Name.png"
# Capture on the device and pull: PowerShell's ">" redirection writes UTF-16 and
# corrupts the PNG bytes, so exec-out piping into a file does not work here.
& $adb shell screencap -p /sdcard/_tide_shot.png | Out-Null
& $adb pull /sdcard/_tide_shot.png $dst | Out-Null
if (-not (Test-Path $dst) -or (Get-Item $dst).Length -lt 10000) {
  Write-Host "capture failed for $Name"
  exit 1
}
Write-Host "full  -> $dst ($([math]::Round((Get-Item $dst).Length/1KB)) KB)"

$py = @"
import sys
from PIL import Image
src, dst, w = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGB')
h = round(im.height * w / im.width)
im.resize((w, h), Image.LANCZOS).save(dst)
print('small ->', dst, im.size, '->', (w, h))
"@
$pyPath = Join-Path $env:TEMP 'tide_downscale.py'
Set-Content -Path $pyPath -Value $py -Encoding UTF8
python $pyPath $dst (Join-Path $outDir "$Name.small.png") $SmallWidth
