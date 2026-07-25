@echo off
setlocal EnableExtensions
REM Forward to the root ASCII launcher (more reliable for shortcuts).
call "%~dp0..\start-eco-toolbox.cmd"
exit /b %ERRORLEVEL%
