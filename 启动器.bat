@echo off
setlocal EnableDelayedExpansion
title ComfyUI Lite

cd /d "%~dp0"

echo ========================================
echo    ComfyUI Lite Launcher
echo ========================================
echo.

set PYTHON=
if exist "python\python.exe" set "PYTHON=python\python.exe"
if exist "python_embeded\python.exe" set "PYTHON=python_embeded\python.exe"

if "!PYTHON!"=="" (
    echo [ERROR] Python not found!
    pause
    exit /b 1
)
echo [OK] Python: !PYTHON!

netstat -an | findstr "8188" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo Server already running
    goto open
)

echo Starting server...
start "ComfyUIServer" /min cmd /c "!PYTHON!" -s main.py --windows-standalone-build --listen 0.0.0.0 --port 8188

echo Waiting for server...
set count=0
:waitloop
timeout /t 2 /nobreak >nul
set /a count=!count!+1
netstat -an | findstr "8188" | findstr "LISTENING" >nul 2>&1
if !errorlevel!==0 goto ready
if !count! geq 120 goto timeout
echo    waiting... !count!
goto waitloop

:timeout
echo [ERROR] Server did not start.
pause
exit /b 1

:ready
timeout /t 2 /nobreak >nul
echo Server is ready!

:open
echo Opening launcher...
start "" "http://127.0.0.1:8188/launcher"

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127."') do set LOCALIP=%%a
set LOCALIP=!LOCALIP: =!

echo.
echo ========================================
echo  Phone: http://!LOCALIP!:8188/launcher
echo ========================================
echo.
echo Press any key to stop server...
pause >nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8188" ^| findstr "LISTENING"') do taskkill /pid %%p /t /f >nul 2>&1
echo Stopped.
