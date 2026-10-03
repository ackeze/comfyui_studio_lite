@echo off
setlocal EnableDelayedExpansion
title Comfy Studio Lite

set "STUDIO_ROOT=%~dp0"
if not exist "!STUDIO_ROOT!main.py" (
    if exist "%~dp0..\..\main.py" (
        set "STUDIO_ROOT=%~dp0..\..\"
    ) else if exist "%~dp0ComfyUI\main.py" (
        set "STUDIO_ROOT=%~dp0ComfyUI\"
    )
)
if not exist "!STUDIO_ROOT!main.py" goto missingroot
if not exist "!STUDIO_ROOT!folder_paths.py" goto missingroot
for %%d in ("!STUDIO_ROOT!.") do set "STUDIO_ROOT=%%~fd"
cd /d "!STUDIO_ROOT!"

echo ========================================
echo    Comfy Studio Lite Launcher
echo ========================================
echo.

set "STUDIO_PYTHON="
for %%p in ("python\python.exe" "python_embeded\python.exe" "..\python_embeded\python.exe" "venv\Scripts\python.exe" ".venv\Scripts\python.exe") do (
    if "!STUDIO_PYTHON!"=="" if exist "%%~p" set "STUDIO_PYTHON=%%~fp"
)
if "!STUDIO_PYTHON!"=="" (
    where python >nul 2>&1
    if not errorlevel 1 set "STUDIO_PYTHON=python"
)

if "!STUDIO_PYTHON!"=="" (
    echo [ERROR] Python not found!
    pause
    exit /b 1
)
echo [OK] Python: !STUDIO_PYTHON!
set "STUDIO_SERVER_PID="

netstat -ano | findstr /R /C:":8188 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo Server already running
    goto open
)

echo Starting server...
for /f "delims=" %%p in ('powershell -NoProfile -Command "$p = Start-Process -FilePath $env:STUDIO_PYTHON -ArgumentList '-s','main.py','--windows-standalone-build','--disable-auto-launch','--listen','0.0.0.0','--port','8188' -WorkingDirectory $env:STUDIO_ROOT -WindowStyle Hidden -PassThru; $p.Id"') do set "STUDIO_SERVER_PID=%%p"
if "!STUDIO_SERVER_PID!"=="" (
    echo [ERROR] Could not start ComfyUI.
    pause
    exit /b 1
)

echo Waiting for server...
set count=0
:waitloop
timeout /t 2 /nobreak >nul
set /a count=!count!+1
netstat -ano | findstr /R /C:":8188 .*LISTENING" >nul 2>&1
if !errorlevel!==0 goto ready
if !count! geq 120 goto timeout
echo    waiting... !count!
goto waitloop

:timeout
echo [ERROR] Server did not start.
taskkill /pid !STUDIO_SERVER_PID! /t /f >nul 2>&1
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
netsh advfirewall firewall show rule name="Comfy Studio Lite LAN" >nul 2>&1
if errorlevel 1 (
  echo.
  echo If the phone cannot connect, allow this Python in Windows Firewall.
)
echo.
if "!STUDIO_SERVER_PID!"=="" (
    echo Press any key to close this launcher. The existing server will keep running.
    pause >nul
    exit /b 0
)
echo Press any key to stop the server started by this launcher...
pause >nul
taskkill /pid !STUDIO_SERVER_PID! /t /f >nul 2>&1
echo Stopped.
exit /b 0

:missingroot
echo [ERROR] ComfyUI not found. Put this launcher in ComfyUI or its plugin folder.
pause
exit /b 1
