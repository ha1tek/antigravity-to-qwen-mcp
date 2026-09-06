@echo off
setlocal
echo Closing any running Qwen instances...
taskkill /f /im Qwen.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Starting Qwen with remote debugging on port 9222...
start "" "C:\Program Files\Qwen\Qwen.exe" --remote-debugging-port=9222

echo Done. Qwen is launching with remote debugging port 9222.
timeout /t 3
