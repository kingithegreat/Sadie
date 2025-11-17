@echo off
REM Sadie AI Assistant Launcher for Windows

echo ========================================
echo   Sadie AI Assistant
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not installed or not in PATH
    echo Please install Python 3.8+ from https://www.python.org/
    pause
    exit /b 1
)

REM Check if Ollama is running
echo Checking Ollama connection...
curl -s http://localhost:11434/api/tags >nul 2>&1
if errorlevel 1 (
    echo.
    echo Warning: Ollama is not running
    echo Please start Ollama first: ollama serve
    echo.
    pause
    exit /b 1
)

echo Ollama is running!
echo.

REM Start Sadie
echo Starting Sadie...
python -m sadie.main

pause
