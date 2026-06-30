; HomeBot Global Hotkey Script
; AutoHotkey v2.0 — Ctrl+Shift+Space toggles HomeBot window
; 
; Installation:
;   1. Install AutoHotkey v2 from https://www.autohotkey.com/
;   2. Double-click this script (or run: autohotkey.exe HomeBot-Hotkey.ahk)
;   3. Add to startup: Win+R → shell:startup → paste shortcut here
;
; The script:
;   - If HomeBot window exists and is active  → minimize it
;   - If HomeBot window exists but not active → bring it to front
;   - If HomeBot is not running               → launch via start.ps1

#Requires AutoHotkey v2.0

; --- Configuration ---
HOMEBOT_WINDOW_TITLE := "HomeBot"
HOMEBOT_START_SCRIPT := A_ScriptDir "\..\start.ps1"

; --- Hotkey: Ctrl+Shift+Space ---
^+Space:: {
    global HOMEBOT_WINDOW_TITLE, HOMEBOT_START_SCRIPT

    if WinExist(HOMEBOT_WINDOW_TITLE) {
        if WinActive(HOMEBOT_WINDOW_TITLE) {
            WinMinimize HOMEBOT_WINDOW_TITLE
        } else {
            WinActivate HOMEBOT_WINDOW_TITLE
            WinMoveTop HOMEBOT_WINDOW_TITLE
        }
    } else {
        ; Launch HomeBot via PowerShell
        Run 'powershell.exe -NoProfile -WindowStyle Hidden -File "' HOMEBOT_START_SCRIPT '"',, "Hide"
        ; Wait up to 8 seconds for the window to appear
        if WinWait(HOMEBOT_WINDOW_TITLE,, 8) {
            WinActivate HOMEBOT_WINDOW_TITLE
        }
    }
}

; --- Tray tooltip ---
A_TrayMenu.Delete()
A_TrayMenu.Add("Toggle HomeBot (Ctrl+Shift+Space)", (*) => Send("^+Space"))
A_TrayMenu.Add()
A_TrayMenu.Add("Exit", (*) => ExitApp())
A_IconTip := "HomeBot Hotkey (Ctrl+Shift+Space)"
