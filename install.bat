@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
set "PY="
if exist "..\..\python\python.exe" set "PY=..\..\python\python.exe"
if exist "..\..\python_embeded\python.exe" set "PY=..\..\python_embeded\python.exe"
if "%PY%"=="" set "PY=python"
echo Comfy Studio Lite installer
echo Python: %PY%
"%PY%" -s "%~dp0install.py" %*
echo.
pause
