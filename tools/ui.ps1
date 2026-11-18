# UI automation helpers for the emulator.
#
#   powershell -File tools\ui.ps1 -Find                # list clickable nodes with bounds
#   powershell -File tools\ui.ps1 -TapText "No thanks" # tap the first node whose text/desc matches
#   powershell -File tools\ui.ps1 -Tap x y             # tap raw coordinates
#   powershell -File tools\ui.ps1 -Text                # dump every node's text (debug)
#
# Why this exists: guessing tap coordinates from screenshots is unreliable - it cost
# several wrong taps. uiautomator sees native views (not WebView content, though),
# so for anything native this is the accurate way.
#
# NOTE: keep this file pure ASCII (Windows PowerShell 5.1 reads .ps1 as the ANSI code page).

param(
  [switch]$Find,
  [switch]$Text,
  [string]$TapText,
  [int[]]$Tap,
  [int]$Index = 0
)

$ErrorActionPreference = 'Continue'
$adb = 'D:\android-tools\sdk\platform-tools\adb.exe'
$dump = Join-Path $env:TEMP 'tide_ui.xml'

function Get-Nodes {
  & $adb shell uiautomator dump /sdcard/tide_ui.xml | Out-Null
  & $adb pull /sdcard/tide_ui.xml $dump | Out-Null
  if (-not (Test-Path $dump)) { throw 'uiautomator dump failed' }
  return ([xml](Get-Content $dump -Encoding UTF8)).SelectNodes('//node')
}

function Get-Center($bounds) {
  # bounds looks like [x1,y1][x2,y2]
  if ($bounds -match '\[(\d+),(\d+)\]\[(\d+),(\d+)\]') {
    return @([int](([int]$Matches[1] + [int]$Matches[3]) / 2), [int](([int]$Matches[2] + [int]$Matches[4]) / 2))
  }
  return $null
}

if ($Find -or $Text) {
  $nodes = Get-Nodes
  $i = 0
  foreach ($n in $nodes) {
    $t = $n.text
    $d = $n.'content-desc'
    if (-not $Text -and $n.clickable -ne 'true') { continue }
    if ([string]::IsNullOrEmpty($t) -and [string]::IsNullOrEmpty($d)) { continue }
    Write-Output ("[{0}] {1} text='{2}' desc='{3}'" -f $i, $n.bounds, $t, $d)
    $i++
  }
  exit 0
}

if ($TapText) {
  $nodes = Get-Nodes
  $hits = @($nodes | Where-Object {
    $_.clickable -eq 'true' -and ($_.text -match $TapText -or $_.'content-desc' -match $TapText)
  })
  if ($hits.Count -eq 0) {
    Write-Output "no clickable node matched '$TapText'"
    exit 2
  }
  $node = $hits[[Math]::Min($Index, $hits.Count - 1)]
  $c = Get-Center $node.bounds
  if (-not $c) { Write-Output "bad bounds $($node.bounds)"; exit 3 }
  Write-Output ("tap '{0}' at {1},{2} ({3})" -f $node.text, $c[0], $c[1], $node.bounds)
  & $adb shell input tap $c[0] $c[1]
  exit 0
}

if ($Tap -and $Tap.Count -eq 2) {
  Write-Output ("tap {0},{1}" -f $Tap[0], $Tap[1])
  & $adb shell input tap $Tap[0] $Tap[1]
  exit 0
}

Write-Output 'nothing to do; see the header of this file for usage'
