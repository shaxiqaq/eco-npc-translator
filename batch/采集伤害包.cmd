@echo off
title ECO Damage Packet Capture
echo ============================================
echo   ECO Damage Packet Capture
echo   - Make sure eco.exe is running and logged in
echo   - F8 marks a test stage
echo   - F9 prints opcode stats
echo   - Ctrl+C stops
echo ============================================
echo.
set "ECO_DATA_DIR=%~dp0..\data"
python "%~dp0..\src\eco_damage_capture.py"
echo.
echo [Stopped] Press any key to close...
pause >nul
