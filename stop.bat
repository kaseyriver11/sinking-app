@echo off
rem Stops the Sinking Funds local server, however it was started
rem (start.bat, or the hidden autostart script).

set PORT=8756
set FOUND=0

for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  taskkill /F /PID %%p >nul 2>&1
  set FOUND=1
)

if "%FOUND%"=="1" (
  echo Sinking Funds server stopped.
) else (
  echo No server was running on port %PORT%.
)
pause
