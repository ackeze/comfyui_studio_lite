@echo off
setlocal
title Comfy Studio AI Key Setup
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-ai-key.ps1"

echo.
pause
