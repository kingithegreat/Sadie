@echo off
REM HomeBot launcher for Windows (double-click). Thin wrapper around start.ps1.
REM   start.bat          quick start
REM   start.bat -Full    full dependency checks before launch (see start.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
