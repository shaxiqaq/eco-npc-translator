@echo off
set "ECO_DATA_DIR=%~dp0..\data"
start "" pythonw "%~dp0..\src\eco_settings.py"
