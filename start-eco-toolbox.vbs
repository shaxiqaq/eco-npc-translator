Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = """" & root & "\start-eco-toolbox.cmd"""
sh.Run cmd, 0, False
