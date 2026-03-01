; SADIE Global Hotkey Script
; AutoHotkey v2.0 — Ctrl+Shift+Space toggles SADIE window
; 
; Installation:
;   1. Install AutoHotkey v2 from https://www.autohotkey.com/
;   2. Double-click this script (or run: autohotkey.exe SADIE-Hotkey.ahk)
;   3. Add to startup: Win+R → shell:startup → paste shortcut here
;
; The script:
;   - If SADIE window exists and is active  → minimize it
;   - If SADIE window exists but not active → bring it to front
;   - If SADIE is not running               → launch via start.ps1

#Requires AutoHotkey v2.0

; --- Configuration ---
SADIE_WINDOW_TITLE := "SADIE"
SADIE_START_SCRIPT := A_ScriptDir "\..\start.ps1"

; --- Hotkey: Ctrl+Shift+Space ---
^+Space:: {
    global SADIE_WINDOW_TITLE, SADIE_START_SCRIPT

    if WinExist(SADIE_WINDOW_TITLE) {
        if WinActive(SADIE_WINDOW_TITLE) {
            WinMinimize SADIE_WINDOW_TITLE
        } else {
            WinActivate SADIE_WINDOW_TITLE
            WinMoveTop SADIE_WINDOW_TITLE
        }
    } else {
        ; Launch SADIE via PowerShell
        Run 'powershell.exe -NoProfile -WindowStyle Hidden -File "' SADIE_START_SCRIPT '"',, "Hide"
        ; Wait up to 8 seconds for the window to appear
        if WinWait(SADIE_WINDOW_TITLE,, 8) {
            WinActivate SADIE_WINDOW_TITLE
        }
    }
}

; --- Tray tooltip ---
A_TrayMenu.Delete()
A_TrayMenu.Add("Toggle SADIE (Ctrl+Shift+Space)", (*) => Send("^+Space"))
A_TrayMenu.Add()
A_TrayMenu.Add("Exit", (*) => ExitApp())
A_IconTip := "SADIE Hotkey (Ctrl+Shift+Space)"
