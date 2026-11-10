# Recreate desktop shortcut for IndicFlow
$rootDir = (Get-Item $PSScriptRoot).Parent.FullName
$iconPath = Join-Path $rootDir "assets\icon.ico"
$workDir = $rootDir

$desktops = @(
    [Environment]::GetFolderPath("Desktop"),
    (Join-Path $env:USERPROFILE "OneDrive\Desktop"),
    (Join-Path $env:USERPROFILE "Desktop")
) | Select-Object -Unique

$WshShell = New-Object -ComObject WScript.Shell

foreach ($desk in $desktops) {
    if (Test-Path $desk) {
        $shortcutPath = Join-Path $desk "IndicFlow.lnk"
        
        if (Test-Path $shortcutPath) {
            Remove-Item $shortcutPath -Force -ErrorAction SilentlyContinue
        }

        $shortcut = $WshShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = "cmd.exe"
        $shortcut.Arguments = "/c npm start"
        $shortcut.WorkingDirectory = $workDir
        $shortcut.IconLocation = "$iconPath,0"
        $shortcut.Description = "IndicFlow Voice Dictation & AI Companion"
        $shortcut.WindowStyle = 7
        $shortcut.Save()

        Write-Host "Created IndicFlow shortcut at: $shortcutPath"
    }
}

# Add P/Invoke signature for SHChangeNotify to force desktop icon refresh
$signature = @'
[DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = true)]
public static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);
'@
try {
    $Shell32 = Add-Type -MemberDefinition $signature -Name "Shell32Helper" -Namespace "Win32" -PassThru
    # SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_FLUSH = 0x1000
    $Shell32::SHChangeNotify(0x08000000, 0x1000, [IntPtr]::Zero, [IntPtr]::Zero)
    Write-Host "Triggered Windows Shell icon refresh (SHChangeNotify)"
} catch {
    Write-Host "Shell notification fallback: $_"
}
