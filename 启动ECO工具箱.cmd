@echo off
setlocal
cd /d "%~dp0electron" || goto :failed

if exist "release\win-unpacked\ECO Toolbox.exe" (
  start "" "release\win-unpacked\ECO Toolbox.exe"
  exit /b 0
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing Electron dependencies for the first run...
  call npm.cmd install
  if errorlevel 1 goto :failed
)

call npm.cmd start
if errorlevel 1 goto :failed
exit /b 0

:failed
echo.
echo ECO Toolbox failed to start.
echo Project directory: %~dp0electron
pause
exit /b 1
