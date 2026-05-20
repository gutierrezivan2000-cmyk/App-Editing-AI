' run-ps1-hidden.vbs <ruta-al-ps1>
'
' Wrapper VBS para ejecutar un script PowerShell COMPLETAMENTE sin ventana.
'
' Por que existe: PowerShell.exe -WindowStyle Hidden NO oculta del todo en
' Windows — la consola parpadea brevemente al crear el proceso, lo que
' interrumpe el foco del usuario cada vez que el watchdog corre (cada 5min).
'
' WScript con `WshShell.Run cmd, 0` crea el proceso con el flag vbHide,
' que SI evita el flash de consola. Es el mismo truco que usa
' pm2-windows-startup para correr `pm2 resurrect` al login sin que se vea.
'
' Uso desde Task Scheduler:
'   wscript.exe "E:\...\scripts\run-ps1-hidden.vbs" "E:\...\scripts\foo.ps1"

If WScript.Arguments.Count < 1 Then
  WScript.Quit 1
End If

Dim WshShell, ps1Path, cmd
Set WshShell = CreateObject("WScript.Shell")
ps1Path = WScript.Arguments(0)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ps1Path & """"

' Run(command, windowStyle, waitForExit)
'   windowStyle = 0  -> vbHide, sin ventana en absoluto
'   waitForExit = False -> fire and forget, el VBS termina inmediatamente
WshShell.Run cmd, 0, False
Set WshShell = Nothing
