@echo off
REM SADIE Widget Launcher
REM Run this script from anywhere to start the SADIE widget

cd /d "%~dp0widget"
echo Starting SADIE Widget from: %cd%
npm start
