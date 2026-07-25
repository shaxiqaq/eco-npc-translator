@echo off
chcp 65001 >nul
cd /d "%~dp0"
py -3 "%~dp0..\src\eco_damage_capture.py" --ops 3999,4001,4002,4005,4006,4999,5001,5005,5010,5025,5030,5035,5040,525,540,4640,4645
if errorlevel 1 python "%~dp0..\src\eco_damage_capture.py" --ops 3999,4001,4002,4005,4006,4999,5001,5005,5010,5025,5030,5035,5040,525,540,4640,4645
pause
