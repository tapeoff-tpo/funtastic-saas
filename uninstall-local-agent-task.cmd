@echo off
setlocal

set "TASK_NAME=FuntasticMarketAgent"

echo Removing %TASK_NAME%...
schtasks /Delete /TN "%TASK_NAME%" /F

echo.
echo Removed.
pause
