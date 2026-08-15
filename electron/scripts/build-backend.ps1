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

# screen_translator lives next to src/ and is copied as data; analysis will not
# follow it unless --paths includes the repo root. uuid / openai / keyboard are
# imported from that package (or lazily) and must be forced into the bundle.
$CommonPaths = @("--paths", $Repo, "--paths", $Src)
$TranslatorHidden = @(
    "--hidden-import", "uuid",
    "--hidden-import", "screen_translator",
    "--hidden-import", "screen_translator.translator",
    "--hidden-import", "screen_translator.config",
    "--hidden-import", "screen_translator.prompts",
    "--hidden-import", "openai",
    "--hidden-import", "keyboard",
    "--hidden-import", "cache_sync",
    "--hidden-import", "eco_source_lang",
    "--hidden-import", "eco_event_cache",
    "--hidden-import", "eco_translation_quality",
    "--hidden-import", "eco_pc_template",
    "--hidden-import", "eco_log",
    "--hidden-import", "eco_paths",
    "--hidden-import", "eco_process"
)
$DamageHidden = @(
    "--hidden-import", "eco_log",
    "--hidden-import", "eco_paths",
    "--hidden-import", "eco_process",
    "--hidden-import", "eco_display_names",
    "--hidden-import", "eco_exp_tracker",
    "--hidden-import", "eco_buffs",
    "--hidden-import", "eco_damage_classify",
    "--hidden-import", "eco_damage_categories",
    "--hidden-import", "eco_damage_ride",
    "--hidden-import", "eco_damage_identity",
    "--hidden-import", "eco_damage_util",
    "--hidden-import", "eco_damage_console"
)

function Test-PackagedBackend {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if (-not (Test-Path -LiteralPath $Exe)) {
        throw "Missing packaged $Label executable: $Exe"
    }
    $out = & $Exe --help 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
        throw "Packaged $Label failed --help (exit $LASTEXITCODE): $out"
    }
    if ($out -match "ModuleNotFoundError|No module named") {
        throw "Packaged $Label is missing a module:`n$out"
    }
    Write-Host "Verified $Label starts (--help)"
}

Push-Location $Src
try {
    python -m PyInstaller --noconfirm --clean --onedir --name eco_damage_bridge `
        --distpath (Join-Path $Dist "damage") `
        --workpath (Join-Path $Work "damage") `
        --specpath (Join-Path $Work "spec-damage") `
        @CommonPaths `
        --add-data "$Src\_damage_capture.js;." `
        --add-data "$Data\skill_names.json;." `
        --add-data "$Data\skill_names_ja.json;." `
        --add-data "$Data\mob_names.json;." `
        --add-data "$Data\buff_names.json;." `
        --add-data "$Data\buff_meta.json;." `
        --add-data "$Data\defensive_skill_ids.json;." `
        --add-data "$Data\job_timer_presets.json;." `
        --add-data "$Data\exp_table.json;." `
        @DamageHidden `
        eco_damage_bridge.py
    if ($LASTEXITCODE -ne 0) { throw "Failed to package the damage capture backend" }

    python -m PyInstaller --noconfirm --clean --onedir --name eco_npc_mitm `
        --distpath (Join-Path $Dist "translator") `
        --workpath (Join-Path $Work "translator") `
        --specpath (Join-Path $Work "spec-translator") `
        @CommonPaths `
        --add-data "$Src\_mitm.js;." `
        --add-data "$ScreenTranslator;screen_translator" `
        @TranslatorHidden `
        eco_npc_mitm.py
    if ($LASTEXITCODE -ne 0) { throw "Failed to package the NPC translation backend" }

    New-Item -ItemType Directory -Path (Join-Path $Work "spec-agent") -Force | Out-Null
    python -m PyInstaller --noconfirm --clean --onedir --name eco_capture_agent `
        --distpath (Join-Path $Dist "agent") `
        --workpath (Join-Path $Work "agent") `
        --specpath (Join-Path $Work "spec-agent") `
        @CommonPaths `
        --add-data "$Src\_damage_capture.js;." `
        --add-data "$Src\_mitm.js;." `
        --add-data "$Data\skill_names.json;." `
        --add-data "$Data\skill_names_ja.json;." `
        --add-data "$Data\mob_names.json;." `
        --add-data "$Data\buff_names.json;." `
        --add-data "$Data\buff_meta.json;." `
        --add-data "$Data\defensive_skill_ids.json;." `
        --add-data "$Data\job_timer_presets.json;." `
        --add-data "$Data\exp_table.json;." `
        --add-data "$ScreenTranslator;screen_translator" `
        --hidden-import eco_damage_bridge `
        --hidden-import eco_damage_meter `
        --hidden-import eco_damage_capture `
        --hidden-import eco_npc_mitm `
        @DamageHidden `
        @TranslatorHidden `
        eco_capture_agent.py
    if ($LASTEXITCODE -ne 0) { throw "Failed to package the unified capture agent" }

    Test-PackagedBackend -Exe (Join-Path $Dist "translator\eco_npc_mitm\eco_npc_mitm.exe") -Label "translator"
    Test-PackagedBackend -Exe (Join-Path $Dist "agent\eco_capture_agent\eco_capture_agent.exe") -Label "agent"
    Test-PackagedBackend -Exe (Join-Path $Dist "damage\eco_damage_bridge\eco_damage_bridge.exe") -Label "damage"
}
finally {
    Pop-Location
}
