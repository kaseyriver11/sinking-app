' Starts the Sinking Funds local server silently — no console window, no
' browser tab. Meant to run automatically at Windows login (see the shortcut
' in shell:startup) so http://127.0.0.1:8756 is always available without
' ever double-clicking start.bat. Skips starting a second server if one is
' already listening on the port.
Set objShell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
cmd = "cmd /c cd /d """ & scriptDir & """ && (netstat -ano | findstr "":8756 "" | findstr ""LISTENING"" >nul || python3 -m http.server 8756 --bind 127.0.0.1)"
objShell.Run cmd, 0, False
