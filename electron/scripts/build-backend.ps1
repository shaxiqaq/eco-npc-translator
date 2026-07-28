$ErrorActionPreference = "Stop"

$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Electron = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Electron "dist-python"
$Work = Join-Path $Electron "build-python"

python -m PyInstaller --version *> $null
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller is required. Run: python -m pip install pyinstaller"
}

Remove-Item -LiteralPath $Dist -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path (Join-Path $Work "spec-damage") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Work "spec-translator") -Force | Out-Null

$Src = Join-Path $Repo "src"
$Data = Join-Path $Repo "data"
$ScreenTranslator = Join-Path $Repo "screen_translator"
if (-not (Test-Path $ScreenTranslator)) {
    $ScreenTranslator = Join-Path $Src "screen_translator"
}

Push-Location $Src
try {
    python -m PyInstaller --noconfirm --clean --onedir --name eco_damage_bridge `
        --distpath (Join-Path $Dist "damage") `
        --workpath (Join-Path $Work "damage") `
        --specpath (Join-Path $Work "spec-damage") `
        --add-data "$Src\_damage_capture.js;." `
        --add-data "$Data\skill_names.json;." `
        --add-data "$Data\skill_names_ja.json;." `
        --add-data "$Data\mob_names.json;." `
        --add-data "$Data\buff_names.json;." `
        --add-data "$Data\buff_meta.json;." `
        --add-data "$Data\defensive_skill_ids.json;." `
        --add-data "$Data\job_timer_presets.json;." `
        --add-data "$Data\exp_table.json;." `
        --hidden-import eco_log `
        --hidden-import eco_paths `
        --hidden-import eco_process `
        --hidden-import eco_display_names `
        --hidden-import eco_exp_tracker `
        eco_damage_bridge.py
    if ($LASTEXITCODE -ne 0) { throw "Failed to package the damage capture backend" }

    python -m PyInstaller --noconfirm --clean --onedir --name eco_npc_mitm `
        --distpath (Join-Path $Dist "translator") `
        --workpath (Join-Path $Work "translator") `
        --specpath (Join-Path $Work "spec-translator") `
        --add-data "$Src\_mitm.js;." `
        --add-data "$ScreenTranslator;screen_translator" `
        --hidden-import cache_sync `
        --hidden-import eco_translation_quality `
        --hidden-import eco_log `
        --hidden-import eco_paths `
        --hidden-import eco_process `
        eco_npc_mitm.py
    if ($LASTEXITCODE -ne 0) { throw "Failed to package the NPC translation backend" }
}
finally {
    Pop-Location
}
