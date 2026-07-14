$ErrorActionPreference = "Stop"

$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Electron = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Electron "dist-python"
$Work = Join-Path $Electron "build-python"

python -m PyInstaller --version *> $null
if ($LASTEXITCODE -ne 0) {
    throw "缺少 PyInstaller，请先运行: python -m pip install pyinstaller"
}

Remove-Item -LiteralPath $Dist -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path (Join-Path $Work "spec-damage") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Work "spec-translator") -Force | Out-Null

Push-Location $Repo
try {
    python -m PyInstaller --noconfirm --clean --onedir --name eco_damage_bridge `
        --distpath (Join-Path $Dist "damage") `
        --workpath (Join-Path $Work "damage") `
        --specpath (Join-Path $Work "spec-damage") `
        --add-data "$Repo\_damage_capture.js;." `
        --add-data "$Repo\skill_names.json;." `
        --add-data "$Repo\mob_names.json;." `
        eco_damage_bridge.py
    if ($LASTEXITCODE -ne 0) { throw "伤害采集后端打包失败" }

    python -m PyInstaller --noconfirm --clean --onedir --name eco_npc_mitm `
        --distpath (Join-Path $Dist "translator") `
        --workpath (Join-Path $Work "translator") `
        --specpath (Join-Path $Work "spec-translator") `
        --add-data "$Repo\_mitm.js;." `
        --add-data "$Repo\screen_translator;screen_translator" `
        --hidden-import cache_sync `
        eco_npc_mitm.py
    if ($LASTEXITCODE -ne 0) { throw "NPC 翻译后端打包失败" }
}
finally {
    Pop-Location
}
