@echo off
setlocal

cd /d "%~dp0"

set "TASK_NAME=FuntasticMarketAgent"
set "RUNNER=%CD%\scripts\run-local-agent.ps1"
set ACTION=powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%RUNNER%"

echo.
echo ========================================
echo  Install Funtastic Local Market Agent
echo ========================================
echo.

if not exist ".env.local" (
  echo ERROR: .env.local was not found in this folder.
  echo Copy the Supabase and Redis variables into .env.local first.
  echo.
  pause
  exit /b 1
)

if not exist "%RUNNER%" (
  echo ERROR: %RUNNER% was not found.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found.
  echo Install Node.js 22 or newer, then run this file again.
  echo.
  pause
  exit /b 1
)

echo Registering Windows scheduled task: %TASK_NAME%
schtasks /Create /TN "%TASK_NAME%" /SC ONLOGON /TR "%ACTION%" /RL LIMITED /F
if errorlevel 1 (
  echo.
  echo ERROR: Failed to register the scheduled task.
  echo Try running this file again as the same Windows user that will use SaaS.
  echo.
  pause
  exit /b 1
)

echo Starting local market agent now...
schtasks /Run /TN "%TASK_NAME%"

echo.
echo Done.
echo The local market agent will now start automatically when this Windows user logs in.
echo Log file:
echo %CD%\logs\market-agent.log
echo.
pause
