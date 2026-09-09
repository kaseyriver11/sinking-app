@echo off
rem Double-click this file to open the Sinking Funds app.
rem Serves this folder on localhost — needed to install the page as a Chrome
rem app (Chrome only offers that for http(s) pages, not file://), which is
rem what unlocks persistent File System Access permission across restarts.
rem Close the "Sinking Funds Server" window to stop the server.

cd /d "%~dp0"
set PORT=8756

rem reuse the server if it's already running
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul
if not errorlevel 1 goto :open

start "Sinking Funds Server" cmd /k "title Sinking Funds Server && echo Serving http://127.0.0.1:%PORT% - close this window to stop the server && python3 -m http.server %PORT% --bind 127.0.0.1"
ping -n 2 127.0.0.1 >nul

:open
start "" "http://127.0.0.1:%PORT%/index.html"
