Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
MsgBox "Nano will now create its Setup file." & vbCrLf & vbCrLf & "This takes about 3-5 minutes. Click OK, then wait for the next message.", 64, "Nano"
If fso.FileExists(dir & "\dist\Nano-Setup.exe") Then fso.DeleteFile dir & "\dist\Nano-Setup.exe", True
sh.Run "cmd /c build.bat > build-log.txt 2>&1", 0, True
desk = sh.SpecialFolders("Desktop")
If fso.FileExists(dir & "\dist\Nano-Setup.exe") Then
  fso.CopyFile dir & "\dist\Nano-Setup.exe", desk & "\Nano-Setup.exe", True
  MsgBox "Done!" & vbCrLf & vbCrLf & "Nano-Setup.exe is on your Desktop. Double-click it to install Nano.", 64, "Nano"
Else
  MsgBox "Something went wrong." & vbCrLf & vbCrLf & "If you have no internet, connect and try again. Otherwise send me the file build-log.txt from this folder.", 16, "Nano"
End If
