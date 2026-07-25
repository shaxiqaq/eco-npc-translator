param(
    [string]$TargetName = "win-unpacked"
)

$ErrorActionPreference = "Stop"

$Electron = Split-Path -Parent $PSScriptRoot
$Repo = Split-Path -Parent $Electron
$Release = [IO.Path]::GetFullPath((Join-Path $Electron "release"))
$Target = [IO.Path]::GetFullPath((Join-Path $Release $TargetName))
$Stage = [IO.Path]::GetFullPath((Join-Path $Electron "build-manual\app"))

$DamageExecutable = Join-Path $Electron "dist-python\damage\eco_damage_bridge\eco_damage_bridge.exe"
$BackendInputs = @(
    "eco_buffs.py",
    "eco_damage_bridge.py",
    "eco_damage_capture.py",
    "eco_damage_meter.py",
    "eco_npc_mitm.py"
) | ForEach-Object {
    $srcPath = Join-Path $Repo "src\$_"
    if (Test-Path -LiteralPath $srcPath) { $srcPath } else { Join-Path $Repo $_ }
}
$NeedsBackendBuild = -not (Test-Path -LiteralPath $DamageExecutable)
if (-not $NeedsBackendBuild) {
    $BuiltAt = (Get-Item -LiteralPath $DamageExecutable).LastWriteTimeUtc
    $NeedsBackendBuild = $BackendInputs | Where-Object {
        (Test-Path -LiteralPath $_) -and (Get-Item -LiteralPath $_).LastWriteTimeUtc -gt $BuiltAt
    } | Select-Object -First 1
}
if ($NeedsBackendBuild) {
    & (Join-Path $PSScriptRoot "build-backend.ps1")
}

if (-not $Target.StartsWith($Release, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Invalid build directory: $Target"
}

$ElectronZip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse `
    -Filter "electron-v35.7.5-win32-x64.zip" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $ElectronZip) {
    throw "Electron 35.7.5 runtime cache was not found. Run npm.cmd start first."
}

foreach ($Path in @($Target, $Stage)) {
    if (Test-Path -LiteralPath $Path) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
        } catch {
            # If locked (running app), build into a fresh sibling directory.
            $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
            $fallback = "$Path-build-$stamp"
            Write-Host "Target locked, using fallback: $fallback"
            if ($Path -eq $Target) { $Target = $fallback }
            else { $Stage = $fallback }
        }
    }
}
New-Item -ItemType Directory -Path $Target, $Stage -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($ElectronZip.FullName, $Target)

Copy-Item -LiteralPath (Join-Path $Electron "main.js") -Destination $Stage
Copy-Item -LiteralPath (Join-Path $Electron "preload.js") -Destination $Stage
Copy-Item -LiteralPath (Join-Path $Electron "package.json") -Destination $Stage
Copy-Item -LiteralPath (Join-Path $Electron "package-lock.json") -Destination $Stage
Copy-Item -LiteralPath (Join-Path $Electron "lib") -Destination $Stage -Recurse
Copy-Item -LiteralPath (Join-Path $Electron "renderer") -Destination $Stage -Recurse
Copy-Item -LiteralPath (Join-Path $Electron "overlay") -Destination $Stage -Recurse

& npm.cmd ci --prefix $Stage --omit=dev --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "Failed to install production dependencies" }
Remove-Item -LiteralPath (Join-Path $Stage "package-lock.json") -Force

$Resources = Join-Path $Target "resources"
Remove-Item -LiteralPath (Join-Path $Resources "default_app.asar") -Force -ErrorAction SilentlyContinue
& (Join-Path $Electron "node_modules\.bin\asar.cmd") pack $Stage (Join-Path $Resources "app.asar")
if ($LASTEXITCODE -ne 0) { throw "Failed to package the application ASAR" }

$UpdateConfig = @"
provider: github
owner: shaxiqaq
repo: eco-npc-translator
updaterCacheDirName: eco-toolbox-updater
"@
[IO.File]::WriteAllText(
    (Join-Path $Resources "app-update.yml"),
    $UpdateConfig,
    [Text.UTF8Encoding]::new($false)
)

$Backend = Join-Path $Resources "backend"
New-Item -ItemType Directory -Path (Join-Path $Backend "damage"), (Join-Path $Backend "translator") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Electron "dist-python\damage\eco_damage_bridge") `
    -Destination (Join-Path $Backend "damage") -Recurse
Copy-Item -LiteralPath (Join-Path $Electron "dist-python\translator\eco_npc_mitm") `
    -Destination (Join-Path $Backend "translator") -Recurse

if (-not (Test-Path -LiteralPath (Join-Path $Electron "dist-native\icon-helper\EcoIconHelper.exe"))) {
    & (Join-Path $PSScriptRoot "build-icon-helper.ps1")
}
Copy-Item -LiteralPath (Join-Path $Electron "dist-native\icon-helper") -Destination $Resources -Recurse

$XiaoyaCoreProject = Join-Path $Electron "native\XiaoyaCore\XiaoyaCore.csproj"
$XiaoyaCoreSource = Join-Path $Electron "native\XiaoyaCore\Program.cs"
$XiaoyaCoreExecutable = Join-Path $Electron "dist-native\xiaoya-core\XiaoyaCore.exe"
$NeedsXiaoyaCoreBuild = -not (Test-Path -LiteralPath $XiaoyaCoreExecutable)
if (-not $NeedsXiaoyaCoreBuild) {
    $XiaoyaCoreBuiltAt = (Get-Item -LiteralPath $XiaoyaCoreExecutable).LastWriteTimeUtc
    $NeedsXiaoyaCoreBuild = (Get-Item -LiteralPath $XiaoyaCoreProject).LastWriteTimeUtc -gt $XiaoyaCoreBuiltAt `
        -or (Get-Item -LiteralPath $XiaoyaCoreSource).LastWriteTimeUtc -gt $XiaoyaCoreBuiltAt
}
if ($NeedsXiaoyaCoreBuild) {
    & (Join-Path $PSScriptRoot "build-xiaoya-core.ps1")
}
Copy-Item -LiteralPath (Join-Path $Electron "dist-native\xiaoya-core") -Destination $Resources -Recurse

# Optional legacy Xiaoya binary (not required when XiaoyaCore is present).
$XiaoyaName = "$([char]0x5c0f)$([char]0x96c5)"
$XiaoyaConfigName = "$XiaoyaName$([char]0x8eab)$([char]0x4f53)$([char]0x914d)$([char]0x7f6e).ini"
$XiaoyaSource = Join-Path $Repo $XiaoyaName
$XiaoyaExe = Join-Path $XiaoyaSource "$XiaoyaName.exe"
$XiaoyaIni = Join-Path $XiaoyaSource $XiaoyaConfigName
$XiaoyaTarget = Join-Path $Resources "xiaoya"
if ((Test-Path -LiteralPath $XiaoyaExe) -and (Test-Path -LiteralPath $XiaoyaIni)) {
    New-Item -ItemType Directory -Path $XiaoyaTarget -Force | Out-Null
    Copy-Item -LiteralPath $XiaoyaExe -Destination $XiaoyaTarget -Force
    Copy-Item -LiteralPath $XiaoyaIni -Destination $XiaoyaTarget -Force
    Write-Host "Bundled optional legacy Xiaoya resources."
} else {
    Write-Host "Skip legacy Xiaoya resources (not found under $XiaoyaSource)."
}

$ElectronExe = Join-Path $Target "electron.exe"
$ToolboxExe = Join-Path $Target "ECO Toolbox.exe"
if (Test-Path -LiteralPath $ElectronExe) {
    Move-Item -LiteralPath $ElectronExe -Destination $ToolboxExe -Force
}
Write-Host "Prepackaged application created: $Target"
