@echo off
chcp 65001 >nul
title ECO NPC 翻译 - 配置
set PYTHONIOENCODING=utf-8
pythonw "%~dp0eco_settings.py" 2>nul
if errorlevel 1 python "%~dp0eco_settings.py"
