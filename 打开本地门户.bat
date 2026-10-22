@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地记忆库门户（可写模式）...
echo   待办「确认无后续」会直接写回 08-AI记忆\待办与下一步.md
echo.
start "记忆库门户服务（关闭此窗口即停止）" /min python serve_portal.py 8765
timeout /t 3 >nul
start "" "http://127.0.0.1:8765/"
