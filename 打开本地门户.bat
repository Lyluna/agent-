@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地记忆库门户...
start "记忆库门户服务（关闭此窗口即停止）" /min python -m http.server 8765
timeout /t 2 >nul
start "" "http://127.0.0.1:8765/"
