# Wispr Flow Native Windows Helper (FlowHelper.exe)

The 64-bit native Windows helper executable for Wispr Flow dictation and context-aware voice typing. Built in high-performance C# compiled via Microsoft .NET Framework 4.8 `csc.exe`.

---

## Key Capabilities

1. **Low-Level Keyboard Hook (`WH_KEYBOARD_LL`)**:
   - Captures global hotkeys without requiring window focus (default: `Ctrl+Shift+Space`, configurable via `SetHotkey` to `Alt+Space` or custom keys).
   - Suppresses trigger key injection so hotkeys do not leak into active inputs.
   - Ignores synthetic injected keystrokes (`LLKHF_INJECTED = 0x10`) to prevent loopback during text injection.
   - Detects Push-to-Talk (hold vs tap) with a 380ms threshold: emits `hold_start` when held, `hold_end` on release.
   - Detects double-tap toggle within 380ms window: emits `press` with `isDoubleTap: true`.

2. **UIAutomation Active Context Extraction (`GetTextBoxInfo`)**:
   - Queries the active foreground window title via Win32 `GetForegroundWindow` and `GetWindowText`.
   - Resolves the active process executable name (e.g., `Code.exe`, `notepad.exe`, `slack.exe`).
   - Extracts focused textbox contents via Windows UIAutomation (`TextPattern.DocumentRange.GetText` or `ValuePattern.Current.Value`).
   - Extracts exact caret bounding rectangle (`X`, `Y`, `Width`, `Height`) via `TextPattern.GetSelection().GetBoundingRectangles()` with fallback to Win32 `GetGUIThreadInfo` caret coordinates and element bounds.

3. **Delayed Clipboard Rendering & Synthetic Paste Injection (`PasteText`)**:
   - Implements delayed clipboard rendering using a hidden message-only window (`HWND_MESSAGE`) receiving `WM_RENDERFORMAT`.
   - Automatically registers Windows 10/11 clipboard exclusion formats `CanIncludeInClipboardHistory` and `CanUploadToCloudClipboard` (set to `0`), preventing dictation paste history from polluting the user's OS clipboard history (`Win+V`).
   - Preserves and cleanly restores previous clipboard contents after paste completion.
   - Issues atomic synthetic `SendInput` keystrokes (`Ctrl+V`).

4. **Multi-Channel JSON-lines IPC**:
   - Reads newline-delimited JSON commands over standard input (`stdin`) and writes responses/events to standard output (`stdout`).
   - Dual-pipe support: automatically detects and hooks CRT file descriptor 3 (`stdio[3]`) when spawned by Electron with private 4-stdio pipes (`['pipe', 'pipe', 'pipe', 'pipe']`).

5. **Focus Change Event Listener**:
   - Integrates Win32 `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` and UIAutomation `Automation.AddAutomationFocusChangedEventHandler` to stream `FocusChanged` events as soon as the user switches active applications.

---

## IPC Protocol Specification

### Commands

#### 1. `Ping`
Request:
```json
{ "id": "req_1", "method": "Ping" }
```
Response:
```json
{ "id": "req_1", "event": "pong", "success": true, "timestamp": "2026-11-04T13:20:27.7589099Z", "result": { "pong": true } }
```

#### 2. `GetTextBoxInfo`
Request:
```json
{ "id": "req_2", "method": "GetTextBoxInfo" }
```
Response:
```json
{
  "id": "req_2",
  "method": "GetTextBoxInfo",
  "success": true,
  "app": "Code.exe",
  "title": "FlowHelper.cs — Visual Studio Code",
  "windowTitle": "FlowHelper.cs — Visual Studio Code",
  "text": "public static void Main()",
  "textboxContents": "public static void Main()",
  "caretRect": { "x": 640.0, "y": 380.0, "width": 8.0, "height": 18.0 },
  "isEditable": true,
  "result": { ... }
}
```

#### 3. `PasteText`
Request:
```json
{ "id": "req_3", "method": "PasteText", "text": "dictated transcription text" }
```
Response:
```json
{ "id": "req_3", "method": "PasteText", "event": "PasteOutcome", "success": true, "result": { "pasted": true, "bytesInjected": 27 } }
```

#### 4. `SetHotkey`
Request:
```json
{ "id": "req_4", "method": "SetHotkey", "hotkey": "Alt+Space" }
```
Response:
```json
{ "id": "req_4", "method": "SetHotkey", "success": true, "hotkey": "Alt+Space" }
```

#### 5. `Exit`
Request:
```json
{ "method": "Exit" }
```
Exits the process cleanly with code `0`.

---

### Unsolicited Emitted Events

#### 1. `ready` (on process startup)
```json
{ "event": "ready", "hotkey": "Ctrl+Shift+Space", "pid": 4840 }
```

#### 2. `HotkeyTriggered`
```json
{ "event": "HotkeyTriggered", "shortcut": "Ctrl+Shift+Space", "triggerType": "press" }
{ "event": "HotkeyTriggered", "shortcut": "Ctrl+Shift+Space", "triggerType": "hold_start" }
{ "event": "HotkeyTriggered", "shortcut": "Ctrl+Shift+Space", "triggerType": "hold_end" }
{ "event": "HotkeyTriggered", "shortcut": "Ctrl+Shift+Space", "triggerType": "press", "isDoubleTap": true }
```

#### 3. `FocusChanged`
```json
{ "event": "FocusChanged", "app": "Code.exe", "title": "index.ts - Visual Studio Code" }
```

---

## Build Instructions

Compile using Microsoft .NET Framework 4.8 64-bit C# Compiler:

```bat
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /target:exe /platform:x64 /out:"F:\wisper flow rea\flow-app\native\FlowHelper.exe" /r:"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationClient.dll" /r:"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationTypes.dll" /r:"System.Windows.Forms.dll" "F:\wisper flow rea\flow-app\native\FlowHelper.cs"
```

Or run:
```bat
build.bat
```

---

## Running the Automated Test Suite

```bash
node test_helper.mjs
```

All 31 assertions verify the complete lifecycle, IPC protocol, UIAutomation extraction, hotkeys, and synthetic paste injection.
