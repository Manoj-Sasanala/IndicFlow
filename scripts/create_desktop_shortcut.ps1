# Recreate desktop shortcut with fresh icon filename and notify shell
$iconPath = "F:\wisper flow rea\flow-app\assets\wispr_flow.ico"
$targetBat = "F:\wisper flow rea\start-flow.bat"
$workDir = "F:\wisper flow rea"

$desktops = @(
    [Environment]::GetFolderPath("Desktop"),
    (Join-Path $env:USERPROFILE "OneDrive\Desktop"),
    (Join-Path $env:USERPROFILE "Desktop")
) | Select-Object -Unique

$WshShell = New-Object -ComObject WScript.Shell

foreach ($desk in $desktops) {
    if (Test-Path $desk) {
        $shortcutPath = Join-Path $desk "Wispr Flow.lnk"
        
        # Remove old shortcut to clear Windows Explorer cache reference
        if (Test-Path $shortcutPath) {
            Remove-Item $shortcutPath -Force -ErrorAction SilentlyContinue
        }

        # Create fresh shortcut with new icon path
        $shortcut = $WshShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $targetBat
        $shortcut.WorkingDirectory = $workDir
        $shortcut.IconLocation = "$iconPath,0"
        $shortcut.Description = "Wispr Flow Voice Dictation"
        $shortcut.WindowStyle = 7
        $shortcut.Save()

        Write-Host "Created fresh shortcut at: $shortcutPath"
        Write-Host "  Icon set to: $iconPath,0"
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
