@echo off
setlocal
cd /d "%~dp0"

rem If the local service is already running, just open it in the browser.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { Start-Process 'http://127.0.0.1:3000'; exit 0 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 exit /b 0

rem Start the server in its own window, then open the browser.
start "NAI Atelier Server" /D "%~dp0" cmd /k "npm start"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:3000"
exit /b 0
