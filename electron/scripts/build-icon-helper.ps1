$ErrorActionPreference = "Stop"

$Electron = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $Electron "native\EcoIconHelper.cs"
$Output = Join-Path $Electron "dist-native\icon-helper"
$Compiler = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
$Unpack = Join-Path $Electron "native\Unpack.dll"
$Executable = Join-Path $Output "EcoIconHelper.exe"

if (-not (Test-Path -LiteralPath $Compiler)) { throw ".NET Framework C# compiler was not found" }
if (-not (Test-Path -LiteralPath $Unpack)) { throw "Unpack.dll was not found" }

Remove-Item -LiteralPath $Output -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Output -Force | Out-Null

& $Compiler /nologo /target:exe /platform:x86 /unsafe /optimize+ `
    /reference:System.Drawing.dll `
    "/out:$Executable" `
    $Source
if ($LASTEXITCODE -ne 0) { throw "Failed to build EcoIconHelper.exe" }

Copy-Item -LiteralPath $Unpack -Destination (Join-Path $Output "Unpack.dll")
Write-Host "ECO icon helper created: $Output"
