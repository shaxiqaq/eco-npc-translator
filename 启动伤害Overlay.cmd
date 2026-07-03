@echo off
chcp 65001 >nul
title 伤害统计悬浮窗
echo ============================================
echo   伤害统计悬浮窗
echo   - 请先打开游戏并登录角色
echo   - 透明、置顶、鼠标穿透显示
echo   - 控制台会同步显示完整统计
echo   - F8 重置当前统计
echo   - F9 关闭悬浮窗
echo   - Ctrl+Alt+方向键 移动并保存位置
echo   - Ctrl+Alt+Home 重新跟随游戏窗口
echo ============================================
echo.
python "%~dp0eco_damage_overlay.py"
echo.
echo [已停止] 按任意键关闭...
pause >nul
