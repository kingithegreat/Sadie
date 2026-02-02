@echo off
SETLOCAL ENABLEDELAYEDEXPANSION
SET BASE=C:\Users\adenk\Desktop\sadie
IF NOT EXIST "%BASE%" (
  echo Base folder "%BASE%" not found. Creating it...
  md "%BASE%"
)
md "%BASE%\sadie-webapp" 2>nul
md "%BASE%\sadie-webapp\src" 2>nul
md "%BASE%\sadie-webapp\src\components" 2>nul
md "%BASE%\sadie-webapp\public" 2>nul
echo Directory listing for %BASE%\sadie-webapp:
dir "%BASE%\sadie-webapp"
echo \nIf everything looks correct, reply here with 'Phase 1 complete' and paste the output above.
pause