# create-homebot-webapp helper scripts ✅

These helper scripts create the Phase 1 directory structure for the standalone web app.

Files added:
- `create-homebot-webapp.ps1` — PowerShell script (preferred on Windows)
- `create-homebot-webapp.bat` — Batch file for Command Prompt

How to run

PowerShell (recommended):
```powershell
cd C:\Users\adenk\Desktop\homebot\scripts\setup
powershell -ExecutionPolicy Bypass -File .\create-homebot-webapp.ps1
```

Command Prompt:
```bat
cd C:\Users\adenk\Desktop\homebot\scripts\setup
create-homebot-webapp.bat
```

What to report back
- Copy and paste the output shown after running the script (the directory listing), or reply with any error text.
- Then reply here with: "Phase 1 complete" so I can mark the TODO and continue with Phase 2.

If you prefer, run the individual commands manually (same results):
```bat
cd C:\Users\adenk\Desktop\homebot
mkdir homebot-webapp
cd homebot-webapp
mkdir src
mkdir src\components
mkdir public
dir
```
