# Thin wrapper: the real logic lives in prune-delivered-apks.py.
#
# This file must stay PURE ASCII (Windows PowerShell 5.1 reads .ps1 as the ANSI
# code page, so Chinese literals would be mangled). The folder path and the
# Chinese file-name patterns live in the Python script instead.

$ErrorActionPreference = 'Stop'
python "$PSScriptRoot\prune-delivered-apks.py"
