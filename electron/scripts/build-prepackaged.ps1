$ErrorActionPreference = "Stop"

$Electron = Split-Path -Parent $PSScriptRoot
$Release = [IO.Path]::GetFullPath((Join-Path $Electron "release"))
$Target = [IO.Path]::GetFullPath((Join-Path $Release "win-unpacked"))
$Stage = [IO.Path]::GetFullPath((Join-Path $Electron "build-manual\app"))

if (-not $Target.StartsWith($Release, [StringComparison]::OrdinalIgnoreCase)) {
    throw "无效构建目录: $Target"
}

$ElectronZip = Get-ChildItem "$env:LOCALAPPDATA\electron\Cache" -Recurse `
    -Filter "electron-v35.7.5-win32-x64.zip" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $ElectronZip) {
    throw "没有找到 Electron 35.7.5 运行时缓存，请先运行 npm.cmd start"
}

Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Target, $Stage -Force | Out-Null
Expand-Archive -LiteralPath $ElectronZip.FullName -DestinationPath $Target -Force

Copy-Item -LiteralPath (Join-Path $Electron "main.js") -Destination $Stage
Copy-Item -LiteralPath (Join-Path $Electron "preload.js") -Destination $Stage
Copy-Item -LiteralPath (Join-Path $Electron "package.json") -Destination $Stage
Copy-Item -LiteralPath (Join-Path $Electron "renderer") -Destination $Stage -Recurse
Copy-Item -LiteralPath (Join-Path $Electron "overlay") -Destination $Stage -Recurse

$LucideTarget = Join-Path $Stage "node_modules\lucide\dist\umd"
New-Item -ItemType Directory -Path $LucideTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Electron "node_modules\lucide\dist\umd\lucide.js") -Destination $LucideTarget

$Resources = Join-Path $Target "resources"
Remove-Item -LiteralPath (Join-Path $Resources "default_app.asar") -Force -ErrorAction SilentlyContinue
& (Join-Path $Electron "node_modules\.bin\asar.cmd") pack $Stage (Join-Path $Resources "app.asar")
if ($LASTEXITCODE -ne 0) { throw "应用 ASAR 打包失败" }

$Backend = Join-Path $Resources "backend"
New-Item -ItemType Directory -Path (Join-Path $Backend "damage"), (Join-Path $Backend "translator") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Electron "dist-python\damage\eco_damage_bridge") `
    -Destination (Join-Path $Backend "damage") -Recurse
Copy-Item -LiteralPath (Join-Path $Electron "dist-python\translator\eco_npc_mitm") `
    -Destination (Join-Path $Backend "translator") -Recurse

Move-Item -LiteralPath (Join-Path $Target "electron.exe") -Destination (Join-Path $Target "ECO Toolbox.exe") -Force
Write-Host "预封装程序已生成: $Target"
