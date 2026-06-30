@echo off

echo ================================================================
echo                        DEPRECATION WARNING
echo ================================================================
echo This script (start.bat) is DEPRECATED and will be removed soon.
echo 
echo Please use: powershell -ExecutionPolicy Bypass -File start.ps1
echo 
echo Removal Date: February 22, 2026
echo 
echo For migration instructions, see README.md
echo ================================================================
echo.
echo Continuing in 5 seconds... (Press Ctrl+C to cancel)
timeout /t 5
echo.
echo Launching via start.ps1...
powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1"
