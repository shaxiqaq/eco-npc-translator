@echo off
chcp 65001 >nul
title ECO NPC 翻译 (F9 切换中文/英文)
set PYTHONIOENCODING=utf-8

echo ============================================
echo   ECO NPC 实时翻译
echo   - 确保 eco.exe 已经在运行
echo   - 启动后去和 NPC 对话即可看中文
echo   - 按 F9 在 中文 / 英文原文 之间切换
echo   - 关闭本窗口即停止翻译
echo ============================================
echo.

REM 首次使用未配置时, 先打开配置工具
if not exist "%~dp0translate_config.json" (
  echo [首次使用] 还没有配置翻译服务，正在打开配置工具...
  echo            请选择服务商、填入 API Key 后点“保存”，然后重新运行本程序。
  pythonw "%~dp0eco_settings.py"
  echo.
  echo 配置完成后，请重新双击运行本程序。按任意键关闭...
  pause >nul
  exit /b
)

REM 杀掉可能残留的旧进程, 避免重复 hook
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -match 'eco_npc_mitm' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

python "%~dp0eco_npc_mitm.py"

echo.
echo [翻译已停止] 按任意键关闭窗口...
pause >nul
