@echo off
title ECO NPC Translator (F9 = ZH/EN)
echo ============================================
echo   ECO NPC In-game Translator
echo   - Make sure eco.exe is running
echo   - Press F9 to toggle Chinese / English
echo   - Close this window to stop
echo ============================================
echo.
if not exist "%~dp0translate_config.json" goto noconfig
python "%~dp0eco_npc_mitm.py"
echo.
echo [Stopped] Press any key to close...
pause >nul
goto end

:noconfig
echo [First run] No config found. Opening the settings window...
echo Pick a provider, enter your API Key, click Save, then run this again.
start "" pythonw "%~dp0eco_settings.py"
echo.
echo Press any key to close...
pause >nul

:end
