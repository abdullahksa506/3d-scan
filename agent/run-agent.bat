@echo off
REM Double-click this file to start the agent.
REM Keep the window open to keep receiving scan jobs.
title 3D Scan Agent
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent.ps1"
echo.
echo Agent stopped. Press any key to close.
pause >nul
