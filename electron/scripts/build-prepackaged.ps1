$ErrorActionPreference = "Stop"

$Electron = Split-Path -Parent $PSScriptRoot
$Release = [IO.Path]::GetFullPath((Join-Path $Electron "release"))
$Target = [IO.Path]::GetFullPath((Join-Path $Release "win-unpacked"))
$Stage = [IO.Path]::GetFullPath((Join-Path $Electron "build-manual\app"))

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
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
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

Move-Item -LiteralPath (Join-Path $Target "electron.exe") -Destination (Join-Path $Target "ECO Toolbox.exe") -Force
Write-Host "Prepackaged application created: $Target"
