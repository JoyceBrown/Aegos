@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PID_FILE=%SCRIPT_DIR%flclash-watchdog.pid"

echo Stopping FlClash watchdog...
echo.
echo This will stop only the watchdog script. It will not close FlClash or Codex.
echo.

if not exist "%PID_FILE%" (
  echo Watchdog is not running, or the PID file was already removed.
  echo.
  pause
  exit /b 0
)

for /f "usebackq delims=" %%P in ("%PID_FILE%") do set "WATCHDOG_PID=%%P"

if "%WATCHDOG_PID%"=="" (
  del "%PID_FILE%" >nul 2>nul
  echo PID file was empty. It has been cleaned up.
  echo.
  pause
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$targetPid = [int]$env:WATCHDOG_PID; $pidFile = $env:PID_FILE; $p = Get-Process -Id $targetPid -ErrorAction SilentlyContinue; if ($p) { Stop-Process -Id $targetPid -Force; Start-Sleep -Milliseconds 500; Write-Host ('Stopped watchdog. PID=' + $targetPid) } else { Write-Host 'Watchdog process was not running.' }; if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }"

echo.
echo Done.
pause
