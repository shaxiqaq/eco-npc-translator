@echo off
title ECO Align (harvest -> cache)
echo ============================================
echo   ECO Align:  collected English -> Chinese
echo   official from repo where matched, else MT,
echo   then into cache + shared dictionary.
echo ============================================
echo.
set "ECO_DATA_DIR=%~dp0..\data"
python "%~dp0..\src\align_repo.py"
echo.
echo [Done] Press any key to close...
pause >/dev/null
