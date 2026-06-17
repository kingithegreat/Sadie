@echo off
SETLOCAL ENABLEDELAYEDEXPANSION
SET BASE=C:\Users\adenk\Desktop\homebot
IF NOT EXIST "%BASE%" (
  echo Base folder "%BASE%" not found. Creating it...
  md "%BASE%"
)
md "%BASE%\homebot-webapp" 2>nul
md "%BASE%\homebot-webapp\src" 2>nul
md "%BASE%\homebot-webapp\src\components" 2>nul
md "%BASE%\homebot-webapp\public" 2>nul
echo Directory listing for %BASE%\homebot-webapp:
dir "%BASE%\homebot-webapp"
echo \nIf everything looks correct, reply here with 'Phase 1 complete' and paste the output above.
pause