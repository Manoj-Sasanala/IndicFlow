using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;
using System.Windows.Forms;

namespace IndicFlowNativeHelper
{
    internal static class Program
    {
        // -------------------------------------------------------------
        // Win32 Constants
        // -------------------------------------------------------------
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_SYSKEYDOWN = 0x0104;
        private const int WM_SYSKEYUP = 0x0105;
        private const int WM_RENDERFORMAT = 0x0305;
        private const int WM_RENDERALLFORMATS = 0x0306;
        private const int WM_DESTROYCLIPBOARD = 0x0307;

        private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        private const uint WINEVENT_OUTOFCONTEXT = 0x0000;

        private const uint CF_TEXT = 1;
        private const uint CF_UNICODETEXT = 13;

        private const uint INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_KEYUP = 0x0002;

        private const ushort VK_SHIFT = 0x10;
        private const ushort VK_CONTROL = 0x11;
        private const ushort VK_MENU = 0x12; // Alt
        private const ushort VK_LWIN = 0x5B;
        private const ushort VK_RWIN = 0x5C;
        private const ushort VK_SPACE = 0x20;
        private const ushort VK_V = 0x56;

        private const uint GMEM_MOVEABLE = 0x0002;
        private const int DOUBLE_TAP_WINDOW_MS = 380;
        private const int HOLD_THRESHOLD_MS = 380;

        // -------------------------------------------------------------
        // Win32 Structs
        // -------------------------------------------------------------
        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int left;
            public int top;
            public int right;
            public int bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct GUITHREADINFO
        {
            public int cbSize;
            public uint flags;
            public IntPtr hwndActive;
            public IntPtr hwndFocus;
            public IntPtr hwndCapture;
            public IntPtr hwndMenuOwner;
            public IntPtr hwndMoveSize;
            public IntPtr hwndCaret;
            public RECT rcCaret;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public MOUSEKEYBDHARDWAREINPUT mkhi;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct MOUSEKEYBDHARDWAREINPUT
        {
            [FieldOffset(0)]
            public KEYBDINPUT ki;
            [FieldOffset(0)]
            public MOUSEINPUT mi;
            [FieldOffset(0)]
            public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        // -------------------------------------------------------------
        // Win32 Interop
        // -------------------------------------------------------------
        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
        private delegate void WinEventDelegate(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);

        [DllImport("user32.dll")]
        private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern IntPtr GetShellWindow();

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("user32.dll")]
        private static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern ushort MapVirtualKey(uint uCode, uint uMapType);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        private static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);

        [DllImport("user32.dll")]
        private static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool OpenClipboard(IntPtr hWndNewOwner);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool CloseClipboard();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool EmptyClipboard();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr GetClipboardData(uint uFormat);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern uint RegisterClipboardFormat(string lpszFormat);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GlobalLock(IntPtr hMem);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GlobalUnlock(IntPtr hMem);

        [DllImport("msvcrt.dll", SetLastError = true)]
        private static extern IntPtr _get_osfhandle(int fd);

        // -------------------------------------------------------------
        // State Fields
        // -------------------------------------------------------------
        private static IntPtr _hookId = IntPtr.Zero;
        private static LowLevelKeyboardProc _hookCallback;
        private static IntPtr _winEventHook = IntPtr.Zero;
        private static WinEventDelegate _winEventProc;
        private static MessageWindow _msgWindow;

        private static bool _reqCtrl = false;
        private static bool _reqShift = false;
        private static bool _reqAlt = true;
        private static bool _reqWin = false;
        private static Keys _triggerKey = Keys.D;
        private static string _currentHotkeyStr = "Alt+D";

        private static bool _isHotkeyActive = false;
        private static bool _isHolding = false;
        private static bool _isDoubleTap = false;
        private static int _lastTapReleaseTime = 0;
        private static int _hotkeyDownTime = 0;
        private static System.Threading.Timer _holdTimer;

        private static string _lastFocusApp = "";
        private static string _lastFocusTitle = "";
        private static IntPtr _lastTargetHwnd = IntPtr.Zero;

        private static volatile string _pendingPasteText = null;
        private static readonly object _writeLock = new object();
        private static StreamWriter _fd3Writer = null;
        private static StreamWriter _stdoutWriter = null;
        private static uint _parentPid = 0;
        private static bool _isRunning = true;

        // -------------------------------------------------------------
        // Entry Point
        // -------------------------------------------------------------
        [STAThread]
        private static void Main(string[] args)
        {
            try
            {
                Console.OutputEncoding = Encoding.UTF8;
                Console.InputEncoding = Encoding.UTF8;
            }
            catch { }

            try
            {
                _stdoutWriter = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
            }
            catch { }

            try
            {
                string ppidStr = Environment.GetEnvironmentVariable("FLOW_PARENT_PID");
                if (!string.IsNullOrEmpty(ppidStr))
                {
                    uint.TryParse(ppidStr, out _parentPid);
                }
            }
            catch { }

            TryInitFd3();

            _msgWindow = new MessageWindow();
            IntPtr ensureHandle = _msgWindow.Handle;

            _hookCallback = LowLevelKeyboardHandler;
            using (Process curProcess = Process.GetCurrentProcess())
            using (ProcessModule curModule = curProcess.MainModule)
            {
                _hookId = SetWindowsHookEx(WH_KEYBOARD_LL, _hookCallback, GetModuleHandle(curModule.ModuleName), 0);
            }

            _winEventProc = OnWinEventForegroundChanged;
            _winEventHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, _winEventProc, 0, 0, WINEVENT_OUTOFCONTEXT);

            Thread uiaThread = new Thread(() =>
            {
                try
                {
                    Automation.AddAutomationFocusChangedEventHandler(OnAutomationFocusChanged);
                }
                catch { }
            });
            uiaThread.IsBackground = true;
            uiaThread.SetApartmentState(ApartmentState.MTA);
            uiaThread.Start();

            _holdTimer = new System.Threading.Timer(OnHoldTimerElapsed, null, Timeout.Infinite, Timeout.Infinite);

            Thread ipcThread = new Thread(IpcReaderLoop);
            ipcThread.IsBackground = true;
            ipcThread.Name = "IpcReaderThread";
            ipcThread.Start();

            SendJson(new Dictionary<string, object>
            {
                { "event", "ready" },
                { "hotkey", _currentHotkeyStr },
                { "pid", Process.GetCurrentProcess().Id }
            });

            Application.Run(_msgWindow);

            _isRunning = false;
            if (_hookId != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_hookId);
                _hookId = IntPtr.Zero;
            }
            if (_winEventHook != IntPtr.Zero)
            {
                UnhookWinEvent(_winEventHook);
                _winEventHook = IntPtr.Zero;
            }
            try
            {
                Automation.RemoveAllEventHandlers();
            }
            catch { }
        }

        // -------------------------------------------------------------
        // Stdio[3] Pipe Support
        // -------------------------------------------------------------
        private static void TryInitFd3()
        {
            try
            {
                IntPtr h3 = _get_osfhandle(3);
                if (h3 != IntPtr.Zero && h3.ToInt64() != -1 && h3.ToInt64() != 0)
                {
                    Microsoft.Win32.SafeHandles.SafeFileHandle sfh = new Microsoft.Win32.SafeHandles.SafeFileHandle(h3, false);
                    FileStream fs = new FileStream(sfh, FileAccess.ReadWrite, 4096, false);
                    _fd3Writer = new StreamWriter(fs, new UTF8Encoding(false)) { AutoFlush = true };

                    Thread fd3Reader = new Thread(() =>
                    {
                        StreamReader reader = new StreamReader(fs, Encoding.UTF8);
                        while (_isRunning)
                        {
                            string line = reader.ReadLine();
                            if (line == null) break;
                            ProcessIpcMessage(line);
                        }
                    });
                    fd3Reader.IsBackground = true;
                    fd3Reader.Name = "Fd3ReaderThread";
                    fd3Reader.Start();
                }
            }
            catch
            {
                _fd3Writer = null;
            }
        }

        // -------------------------------------------------------------
        // IPC Output (JSON-lines)
        // -------------------------------------------------------------
        public static void SendJson(Dictionary<string, object> data)
        {
            string json = SerializeJson(data);
            lock (_writeLock)
            {
                try
                {
                    if (_stdoutWriter != null)
                    {
                        _stdoutWriter.WriteLine(json);
                        _stdoutWriter.Flush();
                    }
                    else
                    {
                        Console.WriteLine(json);
                        Console.Out.Flush();
                    }
                }
                catch { }

                if (_fd3Writer != null)
                {
                    try
                    {
                        _fd3Writer.WriteLine(json);
                        _fd3Writer.Flush();
                    }
                    catch { }
                }
            }
        }

        private static void LogStderr(string message)
        {
            try
            {
                Console.Error.WriteLine(message);
                Console.Error.Flush();
            }
            catch { }
        }

        // -------------------------------------------------------------
        // IPC Input Reader Loop (Strict UTF-8)
        // -------------------------------------------------------------
        private static void IpcReaderLoop()
        {
            try
            {
                using (Stream stdinStream = Console.OpenStandardInput())
                using (StreamReader reader = new StreamReader(stdinStream, new UTF8Encoding(false), false, 4096))
                {
                    while (_isRunning)
                    {
                        string line = reader.ReadLine();
                        if (line == null)
                        {
                            ExitApplication();
                            break;
                        }

                        line = line.Trim();
                        if (line.Length > 0)
                        {
                            ProcessIpcMessage(line);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                LogStderr("IpcReaderLoop error: " + ex.Message);
            }
        }

        private static bool IsOwnProcessWindow(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero) return true;
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == (uint)Process.GetCurrentProcess().Id) return true;
            if (_parentPid != 0 && pid == _parentPid) return true;
            return false;
        }

        private static string FixMojibakeIfNeeded(string text)
        {
            if (string.IsNullOrEmpty(text)) return text;
            if (text.IndexOf('\u00E0') >= 0 || text.IndexOf('\u00C3') >= 0)
            {
                try
                {
                    byte[] rawBytes = Encoding.GetEncoding(1252).GetBytes(text);
                    string repaired = Encoding.UTF8.GetString(rawBytes);
                    if (!repaired.Contains("\uFFFD"))
                    {
                        return repaired;
                    }
                }
                catch { }
            }
            return text;
        }

        private static void ProcessIpcMessage(string jsonStr)
        {
            try
            {
                JsonObject req = SimpleJsonParser.Parse(jsonStr);
                string id = req.GetString("id", "");
                string method = req.GetString("method", req.GetString("command", req.GetString("type", "")));

                if (string.Equals(method, "Ping", StringComparison.OrdinalIgnoreCase))
                {
                    var resp = new Dictionary<string, object>();
                    if (!string.IsNullOrEmpty(id)) resp["id"] = id;
                    resp["event"] = "pong";
                    resp["success"] = true;
                    resp["timestamp"] = DateTime.UtcNow.ToString("o");
                    resp["result"] = new Dictionary<string, object>
                    {
                        { "pong", true },
                        { "timestamp", DateTime.UtcNow.ToString("o") }
                    };
                    SendJson(resp);
                }
                else if (string.Equals(method, "GetTextBoxInfo", StringComparison.OrdinalIgnoreCase))
                {
                    Dictionary<string, object> result = QueryTextBoxInfo();
                    if (!string.IsNullOrEmpty(id)) result["id"] = id;
                    result["method"] = "GetTextBoxInfo";

                    // Include nested result dictionary for dual compatibility
                    result["result"] = new Dictionary<string, object>
                    {
                        { "app", result["app"] },
                        { "title", result["title"] },
                        { "windowTitle", result["windowTitle"] },
                        { "text", result["text"] },
                        { "textboxContents", result["textboxContents"] },
                        { "caretRect", result["caretRect"] },
                        { "isEditable", result["isEditable"] }
                    };
                    SendJson(result);
                }
                else if (string.Equals(method, "PasteText", StringComparison.OrdinalIgnoreCase))
                {
                    string text = req.GetString("text", "");
                    if (string.IsNullOrEmpty(text) && req.Has("payload"))
                    {
                        JsonObject payload = req.GetObject("payload");
                        if (payload != null) text = payload.GetString("text", "");
                    }

                    if (_msgWindow != null && _msgWindow.IsHandleCreated)
                    {
                        _msgWindow.BeginInvoke((Action)(() =>
                        {
                            bool ok = ExecuteSyntheticPaste(text);
                            var resp = new Dictionary<string, object>();
                            if (!string.IsNullOrEmpty(id)) resp["id"] = id;
                            resp["method"] = "PasteText";
                            resp["event"] = "PasteOutcome";
                            resp["success"] = ok;
                            resp["result"] = new Dictionary<string, object>
                            {
                                { "pasted", ok },
                                { "bytesInjected", text.Length }
                            };
                            SendJson(resp);
                        }));
                    }
                    else
                    {
                        bool ok = ExecuteSyntheticPaste(text);
                        var resp = new Dictionary<string, object>();
                        if (!string.IsNullOrEmpty(id)) resp["id"] = id;
                        resp["method"] = "PasteText";
                        resp["event"] = "PasteOutcome";
                        resp["success"] = ok;
                        resp["result"] = new Dictionary<string, object>
                        {
                            { "pasted", ok },
                            { "bytesInjected", text.Length }
                        };
                        SendJson(resp);
                    }
                }
                else if (string.Equals(method, "SetHotkey", StringComparison.OrdinalIgnoreCase))
                {
                    string hotkey = req.GetString("hotkey", "");
                    if (string.IsNullOrEmpty(hotkey) && req.Has("payload"))
                    {
                        JsonObject payload = req.GetObject("payload");
                        if (payload != null) hotkey = payload.GetString("hotkey", "");
                    }

                    bool ok = ConfigureHotkey(hotkey);
                    var resp = new Dictionary<string, object>();
                    if (!string.IsNullOrEmpty(id)) resp["id"] = id;
                    resp["method"] = "SetHotkey";
                    resp["success"] = ok;
                    resp["hotkey"] = _currentHotkeyStr;
                    resp["result"] = new Dictionary<string, object>
                    {
                        { "updated", ok },
                        { "hotkey", _currentHotkeyStr }
                    };
                    SendJson(resp);
                }
                else if (string.Equals(method, "SimulateHotkeyTrigger", StringComparison.OrdinalIgnoreCase))
                {
                    string triggerType = req.GetString("triggerType", "press");
                    bool isDouble = req.GetString("isDoubleTap", "false").Equals("true", StringComparison.OrdinalIgnoreCase);
                    EmitHotkeyEvent(triggerType, isDouble);
                    var resp = new Dictionary<string, object>();
                    if (!string.IsNullOrEmpty(id)) resp["id"] = id;
                    resp["method"] = "SimulateHotkeyTrigger";
                    resp["success"] = true;
                    SendJson(resp);
                }
                else if (string.Equals(method, "SimulateFocusChanged", StringComparison.OrdinalIgnoreCase))
                {
                    string app = req.GetString("app", "testapp.exe");
                    string title = req.GetString("title", "Test Title");
                    var data = new Dictionary<string, object>
                    {
                        { "event", "FocusChanged" },
                        { "app", app },
                        { "title", title }
                    };
                    SendJson(data);
                    var resp = new Dictionary<string, object>();
                    if (!string.IsNullOrEmpty(id)) resp["id"] = id;
                    resp["method"] = "SimulateFocusChanged";
                    resp["success"] = true;
                    SendJson(resp);
                }
                else if (string.Equals(method, "Exit", StringComparison.OrdinalIgnoreCase) ||
                         string.Equals(method, "Quit", StringComparison.OrdinalIgnoreCase))
                {
                    ExitApplication();
                }
                else
                {
                    var resp = new Dictionary<string, object>();
                    if (!string.IsNullOrEmpty(id)) resp["id"] = id;
                    resp["error"] = "Unknown method: " + method;
                    resp["success"] = false;
                    SendJson(resp);
                }
            }
            catch (Exception ex)
            {
                LogStderr("Error processing IPC message: " + ex.Message);
            }
        }

        private static void ExitApplication()
        {
            _isRunning = false;
            try
            {
                if (_msgWindow != null && _msgWindow.IsHandleCreated)
                {
                    _msgWindow.BeginInvoke((Action)(() => Application.Exit()));
                }
                else
                {
                    Environment.Exit(0);
                }
            }
            catch
            {
                Environment.Exit(0);
            }
        }

        // -------------------------------------------------------------
        // Hotkey Configuration & Parsing
        // -------------------------------------------------------------
        private static bool ConfigureHotkey(string hotkeySpec)
        {
            if (string.IsNullOrEmpty(hotkeySpec)) return false;

            try
            {
                string[] parts = hotkeySpec.Split(new char[] { '+', '-' }, StringSplitOptions.RemoveEmptyEntries);
                bool ctrl = false, shift = false, alt = false, win = false;
                Keys key = Keys.None;

                for (int i = 0; i < parts.Length; i++)
                {
                    string p = parts[i].Trim();
                    if (string.Equals(p, "ctrl", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(p, "control", StringComparison.OrdinalIgnoreCase))
                    {
                        ctrl = true;
                    }
                    else if (string.Equals(p, "shift", StringComparison.OrdinalIgnoreCase))
                    {
                        shift = true;
                    }
                    else if (string.Equals(p, "alt", StringComparison.OrdinalIgnoreCase) ||
                             string.Equals(p, "menu", StringComparison.OrdinalIgnoreCase))
                    {
                        alt = true;
                    }
                    else if (string.Equals(p, "win", StringComparison.OrdinalIgnoreCase) ||
                             string.Equals(p, "windows", StringComparison.OrdinalIgnoreCase))
                    {
                        win = true;
                    }
                    else
                    {
                        Keys parsedKey;
                        if (Enum.TryParse<Keys>(p, true, out parsedKey))
                        {
                            key = parsedKey;
                        }
                        else if (p.Length == 1)
                        {
                            char c = char.ToUpperInvariant(p[0]);
                            if (c >= 'A' && c <= 'Z') key = (Keys)c;
                            else if (c >= '0' && c <= '9') key = (Keys)c;
                        }
                    }
                }

                if (key == Keys.None) return false;

                _reqCtrl = ctrl;
                _reqShift = shift;
                _reqAlt = alt;
                _reqWin = win;
                _triggerKey = key;
                _currentHotkeyStr = hotkeySpec;
                return true;
            }
            catch
            {
                return false;
            }
        }

        // -------------------------------------------------------------
        // Low-Level Keyboard Hook Callback
        // -------------------------------------------------------------
        private static IntPtr LowLevelKeyboardHandler(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                KBDLLHOOKSTRUCT kbd = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));

                bool isInjected = (kbd.flags & 0x10) != 0;
                if (!isInjected)
                {
                    int msg = wParam.ToInt32();
                    bool isKeyDown = (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN);
                    bool isKeyUp = (msg == WM_KEYUP || msg == WM_SYSKEYUP);
                    Keys key = (Keys)kbd.vkCode;

                    if (key == _triggerKey)
                    {
                        bool ctrl = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
                        bool shift = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
                        bool alt = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
                        bool win = ((GetAsyncKeyState(VK_LWIN) & 0x8000) != 0) || ((GetAsyncKeyState(VK_RWIN) & 0x8000) != 0);

                        bool modsMatch = (ctrl == _reqCtrl) && (shift == _reqShift) && (alt == _reqAlt) && (win == _reqWin);

                        if (isKeyDown)
                        {
                            if (modsMatch)
                            {
                                if (!_isHotkeyActive)
                                {
                                    IntPtr fg = GetForegroundWindow();
                                    if (fg != IntPtr.Zero && !IsOwnProcessWindow(fg))
                                    {
                                        _lastTargetHwnd = fg;
                                    }

                                    _isHotkeyActive = true;
                                    int now = Environment.TickCount;
                                    int diff = now - _lastTapReleaseTime;

                                    if (_lastTapReleaseTime > 0 && diff > 0 && diff <= DOUBLE_TAP_WINDOW_MS)
                                    {
                                        _isDoubleTap = true;
                                        _lastTapReleaseTime = 0;
                                        _holdTimer.Change(Timeout.Infinite, Timeout.Infinite);

                                        EmitHotkeyEvent("press", true);
                                    }
                                    else
                                    {
                                        _isDoubleTap = false;
                                        _isHolding = false;
                                        _hotkeyDownTime = now;
                                        _holdTimer.Change(HOLD_THRESHOLD_MS, Timeout.Infinite);
                                    }
                                }

                                return (IntPtr)1;
                            }
                            else if (_isHotkeyActive)
                            {
                                HandleHotkeyRelease();
                            }
                        }
                        else if (isKeyUp)
                        {
                            if (_isHotkeyActive)
                            {
                                HandleHotkeyRelease();
                                return (IntPtr)1;
                            }
                        }
                    }
                    else if (isKeyUp && _isHotkeyActive)
                    {
                        if (key == Keys.Menu || key == Keys.LMenu || key == Keys.RMenu)
                        {
                            HandleHotkeyRelease();
                            return (IntPtr)1;
                        }
                        else if (key == Keys.ControlKey || key == Keys.LControlKey || key == Keys.RControlKey ||
                            key == Keys.ShiftKey || key == Keys.LShiftKey || key == Keys.RShiftKey ||
                            key == Keys.LWin || key == Keys.RWin)
                        {
                            HandleHotkeyRelease();
                        }
                    }
                }
            }

            return CallNextHookEx(_hookId, nCode, wParam, lParam);
        }

        private static void OnHoldTimerElapsed(object state)
        {
            if (_isHotkeyActive && !_isHolding && !_isDoubleTap)
            {
                _isHolding = true;
                EmitHotkeyEvent("hold_start", false);
            }
        }

        private static void HandleHotkeyRelease()
        {
            if (!_isHotkeyActive) return;
            _isHotkeyActive = false;
            _holdTimer.Change(Timeout.Infinite, Timeout.Infinite);

            int now = Environment.TickCount;
            if (_isHolding)
            {
                _isHolding = false;
                EmitHotkeyEvent("hold_end", false);
                SendJson(new Dictionary<string, object>
                {
                    { "event", "HotkeyReleased" },
                    { "shortcut", _currentHotkeyStr }
                });
            }
            else if (!_isDoubleTap)
            {
                _lastTapReleaseTime = now;
                EmitHotkeyEvent("press", false);
            }
            else
            {
                _isDoubleTap = false;
            }
        }

        private static void EmitHotkeyEvent(string triggerType, bool isDoubleTap)
        {
            var data = new Dictionary<string, object>
            {
                { "event", "HotkeyTriggered" },
                { "shortcut", _currentHotkeyStr },
                { "triggerType", triggerType }
            };
            if (isDoubleTap)
            {
                data["isDoubleTap"] = true;
            }
            SendJson(data);
        }

        // -------------------------------------------------------------
        // Focus Changed Event Handlers
        // -------------------------------------------------------------
        private static void OnWinEventForegroundChanged(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
        {
            CheckFocusChanged();
        }

        private static void OnAutomationFocusChanged(object sender, AutomationFocusChangedEventArgs e)
        {
            CheckFocusChanged();
        }

        private static void CheckFocusChanged()
        {
            try
            {
                IntPtr hwnd = GetForegroundWindow();
                if (hwnd == IntPtr.Zero) return;

                if (!IsOwnProcessWindow(hwnd))
                {
                    _lastTargetHwnd = hwnd;
                }

                string app = GetProcessExecutableSafe(hwnd);
                string title = GetWindowTitleSafe(hwnd);

                if (app != _lastFocusApp || title != _lastFocusTitle)
                {
                    _lastFocusApp = app;
                    _lastFocusTitle = title;

                    var data = new Dictionary<string, object>
                    {
                        { "event", "FocusChanged" },
                        { "app", app },
                        { "title", title }
                    };
                    SendJson(data);
                }
            }
            catch { }
        }

        private static bool TryExtractRect(object rectObj, out double x, out double y, out double w, out double h)
        {
            x = 0; y = 0; w = 0; h = 0;
            if (rectObj == null) return false;
            try
            {
                Type t = rectObj.GetType();
                PropertyInfo pX = t.GetProperty("X");
                PropertyInfo pY = t.GetProperty("Y");
                PropertyInfo pW = t.GetProperty("Width");
                PropertyInfo pH = t.GetProperty("Height");
                if (pX != null && pY != null && pW != null && pH != null)
                {
                    x = Convert.ToDouble(pX.GetValue(rectObj, null));
                    y = Convert.ToDouble(pY.GetValue(rectObj, null));
                    w = Convert.ToDouble(pW.GetValue(rectObj, null));
                    h = Convert.ToDouble(pH.GetValue(rectObj, null));
                    return (w > 0 && h > 0);
                }
            }
            catch { }
            return false;
        }

        public static Dictionary<string, object> QueryTextBoxInfo()
        {
            IntPtr hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero)
            {
                try { hwnd = GetShellWindow(); } catch { }
            }

            string app = GetProcessExecutableSafe(hwnd);
            string title = GetWindowTitleSafe(hwnd);

            string textboxText = "";
            bool isEditable = false;
            double caretX = 0, caretY = 0, caretW = 0, caretH = 0;
            bool foundCaret = false;

            try
            {
                Task<AutomationElement> task = Task.Factory.StartNew<AutomationElement>(() =>
                {
                    try { return AutomationElement.FocusedElement; } catch { return null; }
                });

                if (task.Wait(500) && task.Result != null)
                {
                    AutomationElement el = task.Result;

                    // 1. Try TextPattern via reflection
                    object textPatObj;
                    if (el.TryGetCurrentPattern(TextPattern.Pattern, out textPatObj) && textPatObj != null)
                    {
                        try
                        {
                            PropertyInfo pDocRange = textPatObj.GetType().GetProperty("DocumentRange");
                            if (pDocRange != null)
                            {
                                object docRange = pDocRange.GetValue(textPatObj, null);
                                if (docRange != null)
                                {
                                    MethodInfo mGetText = docRange.GetType().GetMethod("GetText", new Type[] { typeof(int) });
                                    if (mGetText != null)
                                    {
                                        textboxText = mGetText.Invoke(docRange, new object[] { -1 }) as string ?? "";
                                        isEditable = true;
                                    }
                                }
                            }
                        }
                        catch { }

                        try
                        {
                            MethodInfo mGetSel = textPatObj.GetType().GetMethod("GetSelection");
                            if (mGetSel != null)
                            {
                                object selObj = mGetSel.Invoke(textPatObj, null);
                                if (selObj is Array)
                                {
                                    Array selArr = (Array)selObj;
                                    if (selArr.Length > 0)
                                    {
                                        object range0 = selArr.GetValue(0);
                                        if (range0 != null)
                                        {
                                            MethodInfo mGetRects = range0.GetType().GetMethod("GetBoundingRectangles");
                                            if (mGetRects != null)
                                            {
                                                object rectsObj = mGetRects.Invoke(range0, null);
                                                if (rectsObj is Array)
                                                {
                                                    Array rectsArr = (Array)rectsObj;
                                                    if (rectsArr.Length > 0)
                                                    {
                                                        if (TryExtractRect(rectsArr.GetValue(0), out caretX, out caretY, out caretW, out caretH))
                                                        {
                                                            foundCaret = true;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        catch { }
                    }

                    // 2. Fall back to ValuePattern
                    if (string.IsNullOrEmpty(textboxText))
                    {
                        object valPatObj;
                        if (el.TryGetCurrentPattern(ValuePattern.Pattern, out valPatObj))
                        {
                            ValuePattern vp = (ValuePattern)valPatObj;
                            try
                            {
                                textboxText = vp.Current.Value ?? "";
                                isEditable = !vp.Current.IsReadOnly;
                            }
                            catch { }
                        }
                    }

                    // 3. Fall back element bounds for caret
                    if (!foundCaret)
                    {
                        try
                        {
                            object boundsObj = el.GetCurrentPropertyValue(AutomationElement.BoundingRectangleProperty);
                            if (TryExtractRect(boundsObj, out caretX, out caretY, out caretW, out caretH))
                            {
                                foundCaret = true;
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }

            // 4. Fall back to Win32 GUI Thread Info caret rect if still not found
            if (!foundCaret && hwnd != IntPtr.Zero)
            {
                uint pid;
                uint tid = GetWindowThreadProcessId(hwnd, out pid);
                GUITHREADINFO gui = new GUITHREADINFO();
                gui.cbSize = Marshal.SizeOf(gui);
                if (GetGUIThreadInfo(tid, ref gui))
                {
                    int w = gui.rcCaret.right - gui.rcCaret.left;
                    int h = gui.rcCaret.bottom - gui.rcCaret.top;
                    if (w > 0 && h > 0)
                    {
                        POINT pt = new POINT { x = gui.rcCaret.left, y = gui.rcCaret.top };
                        IntPtr targetHwnd = gui.hwndCaret != IntPtr.Zero ? gui.hwndCaret : (gui.hwndFocus != IntPtr.Zero ? gui.hwndFocus : hwnd);
                        ClientToScreen(targetHwnd, ref pt);
                        caretX = pt.x;
                        caretY = pt.y;
                        caretW = w;
                        caretH = h;
                        foundCaret = true;
                    }
                }
            }

            var caretObj = new Dictionary<string, object>
            {
                { "x", caretX },
                { "y", caretY },
                { "width", caretW },
                { "height", caretH }
            };

            return new Dictionary<string, object>
            {
                { "success", true },
                { "app", app },
                { "title", title },
                { "windowTitle", title },
                { "text", textboxText },
                { "textboxContents", textboxText },
                { "caretRect", caretObj },
                { "isEditable", isEditable }
            };
        }

        private static string GetWindowTitleSafe(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return "";
            try
            {
                int len = GetWindowTextLength(hwnd);
                if (len <= 0) return "";
                StringBuilder sb = new StringBuilder(len + 1);
                GetWindowText(hwnd, sb, sb.Capacity);
                return sb.ToString();
            }
            catch
            {
                return "";
            }
        }

        private static string GetProcessExecutableSafe(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return "";
            try
            {
                uint pid;
                GetWindowThreadProcessId(hwnd, out pid);
                if (pid == 0) return "";
                using (Process proc = Process.GetProcessById((int)pid))
                {
                    try
                    {
                        return proc.MainModule.ModuleName;
                    }
                    catch
                    {
                        return proc.ProcessName + ".exe";
                    }
                }
            }
            catch
            {
                return "";
            }
        }

        // -------------------------------------------------------------
        // Synthetic Paste Injection & Direct Clipboard Placement
        // -------------------------------------------------------------
        private static bool ExecuteSyntheticPaste(string textToPaste)
        {
            if (textToPaste == null) textToPaste = "";
            textToPaste = FixMojibakeIfNeeded(textToPaste);

            try
            {
                // Ensure target window is in the foreground
                IntPtr currentForeground = GetForegroundWindow();
                if (_lastTargetHwnd != IntPtr.Zero)
                {
                    uint myThread = GetCurrentThreadId();
                    uint dummyPid;
                    uint targetThread = GetWindowThreadProcessId(_lastTargetHwnd, out dummyPid);
                    uint fgThread = GetWindowThreadProcessId(currentForeground, out dummyPid);

                    if (myThread != targetThread && targetThread != 0) AttachThreadInput(myThread, targetThread, true);
                    if (fgThread != 0 && fgThread != targetThread) AttachThreadInput(fgThread, targetThread, true);

                    SetForegroundWindow(_lastTargetHwnd);
                    BringWindowToTop(_lastTargetHwnd);

                    if (myThread != targetThread && targetThread != 0) AttachThreadInput(myThread, targetThread, false);
                    if (fgThread != 0 && fgThread != targetThread) AttachThreadInput(fgThread, targetThread, false);

                    Thread.Sleep(60);
                }

                uint cfCanInclude = RegisterClipboardFormat("CanIncludeInClipboardHistory");
                uint cfCanUpload = RegisterClipboardFormat("CanUploadToCloudClipboard");

                bool clipboardSet = false;
                for (int attempt = 0; attempt < 10; attempt++)
                {
                    if (OpenClipboard(IntPtr.Zero))
                    {
                        clipboardSet = true;
                        break;
                    }
                    Thread.Sleep(20);
                }

                if (clipboardSet)
                {
                    EmptyClipboard();

                    if (cfCanInclude != 0)
                    {
                        IntPtr hMem1 = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)4);
                        if (hMem1 != IntPtr.Zero)
                        {
                            IntPtr ptr1 = GlobalLock(hMem1);
                            Marshal.WriteInt32(ptr1, 0);
                            GlobalUnlock(hMem1);
                            SetClipboardData(cfCanInclude, hMem1);
                        }
                    }

                    if (cfCanUpload != 0)
                    {
                        IntPtr hMem2 = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)4);
                        if (hMem2 != IntPtr.Zero)
                        {
                            IntPtr ptr2 = GlobalLock(hMem2);
                            Marshal.WriteInt32(ptr2, 0);
                            GlobalUnlock(hMem2);
                            SetClipboardData(cfCanUpload, hMem2);
                        }
                    }

                    // Directly write CF_UNICODETEXT bytes into clipboard memory
                    byte[] bytes = Encoding.Unicode.GetBytes(textToPaste + "\0");
                    IntPtr hMem = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes.Length);
                    if (hMem != IntPtr.Zero)
                    {
                        IntPtr ptr = GlobalLock(hMem);
                        Marshal.Copy(bytes, 0, ptr, bytes.Length);
                        GlobalUnlock(hMem);
                        SetClipboardData(CF_UNICODETEXT, hMem);
                    }

                    _pendingPasteText = textToPaste;
                    CloseClipboard();
                }
                else
                {
                    for (int r = 0; r < 5; r++)
                    {
                        try
                        {
                            Clipboard.SetDataObject(textToPaste, true, 5, 40);
                            break;
                        }
                        catch
                        {
                            Thread.Sleep(30);
                        }
                    }
                }

                // Settle clipboard notification before sending keys
                Thread.Sleep(50);

                SendCtrlV();

                return true;
            }
            catch (Exception ex)
            {
                LogStderr("Paste injection failed: " + ex.Message);
                return false;
            }
        }

        private static void SendCtrlV()
        {
            // Ensure all modifier keys are released before synthesizing Ctrl+V
            ReleaseModifier(VK_MENU);
            ReleaseModifier(VK_SHIFT);
            ReleaseModifier(VK_LWIN);
            ReleaseModifier(VK_RWIN);
            Thread.Sleep(20);

            // 1. Synthesize Ctrl+V via keybd_event (direct raw input queue dispatch for Chromium / Electron / Antigravity IDE)
            keybd_event((byte)VK_CONTROL, 0x1D, 0, UIntPtr.Zero);
            Thread.Sleep(25);
            keybd_event((byte)VK_V, 0x2F, 0, UIntPtr.Zero);
            Thread.Sleep(35);
            keybd_event((byte)VK_V, 0x2F, KEYEVENTF_KEYUP, UIntPtr.Zero);
            Thread.Sleep(20);
            keybd_event((byte)VK_CONTROL, 0x1D, KEYEVENTF_KEYUP, UIntPtr.Zero);
            Thread.Sleep(15);

            // 2. Also send via SendInput with explicit scan codes as dual guarantee
            INPUT[] inputs = new INPUT[4];
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].mkhi.ki.wVk = VK_CONTROL;
            inputs[0].mkhi.ki.wScan = 0x1D;
            inputs[0].mkhi.ki.dwFlags = 0;

            inputs[1].type = INPUT_KEYBOARD;
            inputs[1].mkhi.ki.wVk = VK_V;
            inputs[1].mkhi.ki.wScan = 0x2F;
            inputs[1].mkhi.ki.dwFlags = 0;

            inputs[2].type = INPUT_KEYBOARD;
            inputs[2].mkhi.ki.wVk = VK_V;
            inputs[2].mkhi.ki.wScan = 0x2F;
            inputs[2].mkhi.ki.dwFlags = KEYEVENTF_KEYUP;

            inputs[3].type = INPUT_KEYBOARD;
            inputs[3].mkhi.ki.wVk = VK_CONTROL;
            inputs[3].mkhi.ki.wScan = 0x1D;
            inputs[3].mkhi.ki.dwFlags = KEYEVENTF_KEYUP;

            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private static void ReleaseModifier(ushort vk)
        {
            if ((GetAsyncKeyState(vk) & 0x8000) != 0)
            {
                keybd_event((byte)vk, (byte)MapVirtualKey(vk, 0), KEYEVENTF_KEYUP, UIntPtr.Zero);
                INPUT up = new INPUT();
                up.type = INPUT_KEYBOARD;
                up.mkhi.ki.wVk = vk;
                up.mkhi.ki.wScan = (ushort)MapVirtualKey(vk, 0);
                up.mkhi.ki.dwFlags = KEYEVENTF_KEYUP;
                SendInput(1, new INPUT[] { up }, Marshal.SizeOf(typeof(INPUT)));
            }
        }

        // -------------------------------------------------------------
        // Hidden Message-Only Window for WM_RENDERFORMAT
        // -------------------------------------------------------------
        private sealed class MessageWindow : Form
        {
            public MessageWindow()
            {
                ShowInTaskbar = false;
                WindowState = FormWindowState.Minimized;
                FormBorderStyle = FormBorderStyle.None;
                Size = new System.Drawing.Size(0, 0);
                CreateHandle();
            }

            protected override void SetVisibleCore(bool value)
            {
                base.SetVisibleCore(false);
            }

            protected override void WndProc(ref Message m)
            {
                if (m.Msg == WM_RENDERFORMAT)
                {
                    uint format = (uint)m.WParam.ToInt32();
                    if (format == CF_UNICODETEXT && _pendingPasteText != null)
                    {
                        byte[] bytes = Encoding.Unicode.GetBytes(_pendingPasteText + "\0");
                        IntPtr hMem = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes.Length);
                        if (hMem != IntPtr.Zero)
                        {
                            IntPtr ptr = GlobalLock(hMem);
                            Marshal.Copy(bytes, 0, ptr, bytes.Length);
                            GlobalUnlock(hMem);
                            SetClipboardData(CF_UNICODETEXT, hMem);
                        }
                    }
                    return;
                }
                else if (m.Msg == WM_RENDERALLFORMATS)
                {
                    if (OpenClipboard(this.Handle))
                    {
                        if (_pendingPasteText != null)
                        {
                            byte[] bytes = Encoding.Unicode.GetBytes(_pendingPasteText + "\0");
                            IntPtr hMem = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes.Length);
                            if (hMem != IntPtr.Zero)
                            {
                                IntPtr ptr = GlobalLock(hMem);
                                Marshal.Copy(bytes, 0, ptr, bytes.Length);
                                GlobalUnlock(hMem);
                                SetClipboardData(CF_UNICODETEXT, hMem);
                            }
                        }
                        CloseClipboard();
                    }
                    return;
                }
                else if (m.Msg == WM_DESTROYCLIPBOARD)
                {
                    _pendingPasteText = null;
                    return;
                }

                base.WndProc(ref m);
            }
        }

        // -------------------------------------------------------------
        // Clean, Dependency-Free JSON Serializer & Parser
        // -------------------------------------------------------------
        public static string SerializeJson(object obj)
        {
            if (obj == null) return "null";

            if (obj is string)
            {
                return EscapeJsonString((string)obj);
            }
            if (obj is bool)
            {
                return (bool)obj ? "true" : "false";
            }
            if (obj is int || obj is long || obj is short || obj is byte ||
                obj is uint || obj is ulong || obj is ushort)
            {
                return obj.ToString();
            }
            if (obj is double || obj is float)
            {
                return string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0:G}", obj);
            }
            if (obj is IDictionary<string, object>)
            {
                var dict = (IDictionary<string, object>)obj;
                StringBuilder sb = new StringBuilder("{");
                bool first = true;
                foreach (var kvp in dict)
                {
                    if (!first) sb.Append(",");
                    first = false;
                    sb.Append(EscapeJsonString(kvp.Key));
                    sb.Append(":");
                    sb.Append(SerializeJson(kvp.Value));
                }
                sb.Append("}");
                return sb.ToString();
            }
            if (obj is System.Collections.IEnumerable)
            {
                var list = (System.Collections.IEnumerable)obj;
                StringBuilder sb = new StringBuilder("[");
                bool first = true;
                foreach (var item in list)
                {
                    if (!first) sb.Append(",");
                    first = false;
                    sb.Append(SerializeJson(item));
                }
                sb.Append("]");
                return sb.ToString();
            }

            return EscapeJsonString(obj.ToString());
        }

        private static string EscapeJsonString(string s)
        {
            if (s == null) return "null";
            StringBuilder sb = new StringBuilder(s.Length + 8);
            sb.Append('"');
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 32 || c > 126)
                        {
                            sb.AppendFormat("\\u{0:x4}", (int)c);
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        public class JsonObject
        {
            public readonly Dictionary<string, object> Dict = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

            public bool Has(string key)
            {
                return Dict.ContainsKey(key);
            }

            public string GetString(string key, string fallback = "")
            {
                object val;
                if (Dict.TryGetValue(key, out val) && val != null)
                {
                    return val.ToString();
                }
                return fallback;
            }

            public JsonObject GetObject(string key)
            {
                object val;
                if (Dict.TryGetValue(key, out val))
                {
                    if (val is JsonObject) return (JsonObject)val;
                    if (val is Dictionary<string, object>)
                    {
                        JsonObject jo = new JsonObject();
                        foreach (var kvp in (Dictionary<string, object>)val)
                            jo.Dict[kvp.Key] = kvp.Value;
                        return jo;
                    }
                }
                return null;
            }
        }

        public static class SimpleJsonParser
        {
            public static JsonObject Parse(string json)
            {
                JsonObject result = new JsonObject();
                if (string.IsNullOrEmpty(json)) return result;

                int i = 0;
                SkipWhite(json, ref i);
                if (i >= json.Length || json[i] != '{') return result;
                i++;

                while (i < json.Length)
                {
                    SkipWhite(json, ref i);
                    if (i >= json.Length || json[i] == '}') break;

                    if (json[i] == ',')
                    {
                        i++;
                        SkipWhite(json, ref i);
                    }
                    if (i >= json.Length || json[i] == '}') break;

                    string key = ParseString(json, ref i);
                    SkipWhite(json, ref i);
                    if (i < json.Length && json[i] == ':') i++;
                    SkipWhite(json, ref i);

                    object val = ParseValue(json, ref i);
                    result.Dict[key] = val;
                }

                return result;
            }

            private static void SkipWhite(string s, ref int i)
            {
                while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\r' || s[i] == '\n'))
                    i++;
            }

            private static string ParseString(string s, ref int i)
            {
                if (i >= s.Length || s[i] != '"') return "";
                i++;
                StringBuilder sb = new StringBuilder();
                while (i < s.Length)
                {
                    char c = s[i++];
                    if (c == '"') break;
                    if (c == '\\' && i < s.Length)
                    {
                        char esc = s[i++];
                        switch (esc)
                        {
                            case '"': sb.Append('"'); break;
                            case '\\': sb.Append('\\'); break;
                            case '/': sb.Append('/'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'u':
                                if (i + 4 <= s.Length)
                                {
                                    string hex = s.Substring(i, 4);
                                    i += 4;
                                    sb.Append((char)Convert.ToInt32(hex, 16));
                                }
                                break;
                            default: sb.Append(esc); break;
                        }
                    }
                    else
                    {
                        sb.Append(c);
                    }
                }
                return sb.ToString();
            }

            private static object ParseValue(string s, ref int i)
            {
                SkipWhite(s, ref i);
                if (i >= s.Length) return null;

                char c = s[i];
                if (c == '"')
                {
                    return ParseString(s, ref i);
                }
                if (c == '{')
                {
                    int start = i;
                    int depth = 0;
                    bool inStr = false;
                    while (i < s.Length)
                    {
                        char ch = s[i++];
                        if (ch == '"' && (i == 1 || s[i - 2] != '\\')) inStr = !inStr;
                        if (!inStr)
                        {
                            if (ch == '{') depth++;
                            else if (ch == '}')
                            {
                                depth--;
                                if (depth == 0) break;
                            }
                        }
                    }
                    string sub = s.Substring(start, i - start);
                    return Parse(sub);
                }
                if (c == 't' || c == 'T')
                {
                    if (i + 4 <= s.Length && string.Equals(s.Substring(i, 4), "true", StringComparison.OrdinalIgnoreCase))
                    {
                        i += 4;
                        return true;
                    }
                }
                if (c == 'f' || c == 'F')
                {
                    if (i + 5 <= s.Length && string.Equals(s.Substring(i, 5), "false", StringComparison.OrdinalIgnoreCase))
                    {
                        i += 5;
                        return false;
                    }
                }
                if (c == 'n' || c == 'N')
                {
                    if (i + 4 <= s.Length && string.Equals(s.Substring(i, 4), "null", StringComparison.OrdinalIgnoreCase))
                    {
                        i += 4;
                        return null;
                    }
                }

                int numStart = i;
                while (i < s.Length && (char.IsDigit(s[i]) || s[i] == '-' || s[i] == '+' || s[i] == '.' || s[i] == 'e' || s[i] == 'E'))
                {
                    i++;
                }
                string numStr = s.Substring(numStart, i - numStart);
                double dbl;
                if (double.TryParse(numStr, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out dbl))
                {
                    return dbl;
                }
                return numStr;
            }
        }
    }
}
