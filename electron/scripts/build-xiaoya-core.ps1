param(
    [switch]$FrameworkDependent
)

$ErrorActionPreference = "Stop"

$Electron = Split-Path -Parent $PSScriptRoot
$Project = Join-Path $Electron "native\XiaoyaCore\XiaoyaCore.csproj"
$Output = Join-Path $Electron "dist-native\xiaoya-core"

if (-not (Test-Path -LiteralPath $Project)) {
    throw "XiaoyaCore project was not found: $Project"
}

if (Test-Path -LiteralPath $Output) {
    Remove-Item -LiteralPath $Output -Recurse -Force
}
New-Item -ItemType Directory -Path $Output -Force | Out-Null

$SelfContained = if ($FrameworkDependent) { "false" } else { "true" }
& dotnet publish $Project `
    --configuration Release `
    --runtime win-x86 `
    --self-contained $SelfContained `
    -p:PublishSingleFile=true `
    -p:DebugType=None `
    -p:DebugSymbols=false `
    --output $Output

if ($LASTEXITCODE -ne 0) {
    throw "Failed to build XiaoyaCore.exe"
}

$Executable = Join-Path $Output "XiaoyaCore.exe"
if (-not (Test-Path -LiteralPath $Executable)) {
    throw "XiaoyaCore.exe was not produced"
}

Write-Host "Xiaoya native core created: $Executable"
