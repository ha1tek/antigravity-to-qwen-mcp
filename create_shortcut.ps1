$WshShell = New-Object -ComObject WScript.Shell
$desktopPath = [System.Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath "Qwen Debug (MCP).lnk"
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "C:\Program Files\Qwen\Qwen.exe"
$Shortcut.Arguments = "--remote-debugging-port=9222"
$Shortcut.WorkingDirectory = "C:\Program Files\Qwen"
$Shortcut.Save()
Write-Host "Shortcut created at $shortcutPath"
