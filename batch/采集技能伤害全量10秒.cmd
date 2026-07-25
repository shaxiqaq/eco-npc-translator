@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==================================================
echo 技能伤害全量采集
echo - 启动后立刻在游戏里使用识别不到的技能 2-3 次
echo - 大约 10 秒后按 Ctrl+C 停止
echo - 日志会保存到 logs\damage_capture_*.jsonl
echo ==================================================
echo.
py -3 "%~dp0..\src\eco_damage_capture.py" --all --quiet
if errorlevel 1 python "%~dp0..\src\eco_damage_capture.py" --all --quiet
pause
