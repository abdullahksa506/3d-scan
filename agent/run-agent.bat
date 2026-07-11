@echo off
REM انقر نقرًا مزدوجًا على هذا الملف لتشغيل الوكيل.
REM اترك النافذة مفتوحة طوال ما تريد استقبال مهام المسح.
title 3D Scan Agent
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent.ps1"
echo.
echo توقف الوكيل. اضغط أي مفتاح للإغلاق.
pause >nul
