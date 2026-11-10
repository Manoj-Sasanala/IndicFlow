@echo off
set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe
set OUT="F:\wisper flow rea\flow-app\native\FlowHelper.exe"
set SRC="F:\wisper flow rea\flow-app\native\FlowHelper.cs"
set REF1="C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationClient.dll"
set REF2="C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationTypes.dll"
set REF3="System.Windows.Forms.dll"

echo Compiling FlowHelper.exe...
%CSC% /target:exe /platform:x64 /out:%OUT% /r:%REF1% /r:%REF2% /r:%REF3% %SRC%
if %ERRORLEVEL% EQU 0 (
    echo Build succeeded: %OUT%
) else (
    echo Build failed with error code %ERRORLEVEL%
)
