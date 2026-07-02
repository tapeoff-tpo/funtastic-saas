@echo off
setlocal

cd /d "%~dp0"

echo.
echo ========================================
echo  Funtastic SaaS Local Market Agent
echo ========================================
echo.
echo This window must stay open while collecting orders or uploading invoices.
echo Close this window to stop the local marketplace agent.
echo.

if not exist ".env.local" (
  echo ERROR: .env.local was not found in this folder.
  echo Copy the production Supabase and Redis variables into .env.local first.
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

call npm.cmd run agent:start

echo.
echo Agent stopped.
pause
