@echo off
setlocal

set "TASK_NAME=FuntasticMarketAgent"

echo Stopping %TASK_NAME%...
schtasks /End /TN "%TASK_NAME%"

echo.
echo If the task was running, it has been asked to stop.
pause
