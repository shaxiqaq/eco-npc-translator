@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "ELECTRON_DIR=%ROOT%\electron"
set "ELECTRON_EXE=%ELECTRON_DIR%\node_modules\electron\dist\electron.exe"
set "PACKAGED_EXE=%ELECTRON_DIR%\release\win-unpacked\ECO Toolbox.exe"
set "PACKAGED_EXE2=%ELECTRON_DIR%\release\win-unpacked\electron.exe"
set "LOGDIR=%ROOT%\logs"
set "LOGFILE=%LOGDIR%\launch.log"
set "PATH=C:\Program Files\nodejs;%PATH%"

if not exist "%LOGDIR%" mkdir "%LOGDIR%"
>>"%LOGFILE%" echo ===== %DATE% %TIME% =====
>>"%LOGFILE%" echo ROOT=%ROOT%
>>"%LOGFILE%" echo ELECTRON_EXE=%ELECTRON_EXE%

cd /d "%ELECTRON_DIR%"
if errorlevel 1 goto fail_cd

if exist "%ELECTRON_EXE%" goto launch_dev
if exist "%PACKAGED_EXE%" goto launch_pkg1
if exist "%PACKAGED_EXE2%" goto launch_pkg2
goto fail_missing

:launch_dev
>>"%LOGFILE%" echo Launching DEV electron
start "ECO-Toolbox" /D "%ELECTRON_DIR%" "%ELECTRON_EXE%" .
goto end_ok

:launch_pkg1
>>"%LOGFILE%" echo Launching packaged ECO Toolbox.exe
start "" "%PACKAGED_EXE%"
goto end_ok

:launch_pkg2
>>"%LOGFILE%" echo Launching packaged electron.exe
start "" "%PACKAGED_EXE2%"
goto end_ok

:fail_cd
>>"%LOGFILE%" echo ERROR cannot cd to electron dir
echo Cannot open electron folder:
echo %ELECTRON_DIR%
echo See log: %LOGFILE%
pause
exit /b 1

:fail_missing
>>"%LOGFILE%" echo ERROR electron runtime not found
echo Electron not found.
echo Expected:
echo   %ELECTRON_EXE%
echo Run in electron folder: npm install
echo See log: %LOGFILE%
pause
exit /b 1

:end_ok
>>"%LOGFILE%" echo OK launched
exit /b 0
