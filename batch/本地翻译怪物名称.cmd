@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "ECO_DATA_DIR=%~dp0..\data"
py -3 "%~dp0..\src\translate_mob_names_local.py"
if errorlevel 1 python "%~dp0..\src\translate_mob_names_local.py"
pause
