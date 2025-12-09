@echo off
title SADIE Launcher
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "start-sadie.ps1"
pause
