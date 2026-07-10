@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "SCRIPT=%SCRIPT_DIR%flclash-watchdog.ps1"
set "PID_FILE=%SCRIPT_DIR%flclash-watchdog.pid"

echo Starting FlClash watchdog...
echo.
echo This only starts the watchdog script. It will not close FlClash or Codex.
echo Close it later with stop-flclash-watchdog.bat.
echo.

start "FlClash Watchdog" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Switch -PidPath "%PID_FILE%"

timeout /t 2 /nobreak >nul
echo Done. You can close this window.
pause
