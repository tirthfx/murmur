using System.Runtime.InteropServices;

namespace Murmur.Helper.Windows;

/// <summary>
/// The low-level keyboard and mouse hooks, on one thread with a message loop. They only report key
/// and button changes to the <see cref="HotkeyEngine"/> and return at once: the engine does the
/// work, and the hooks never swallow an input. They run only while at least one binding is set.
/// </summary>
public sealed class WindowsInputHook : IDisposable
{
    private readonly Action<int, bool> _onKey;
    private readonly Action<int, bool> _onMouse;
    private readonly object _gate = new();
    private Thread? _thread;
    private uint _threadId;
    private Native.HookProc? _proc; // kept so it is not collected while installed
    private Native.HookProc? _mouseProc;

    public WindowsInputHook(Action<int, bool> onKey, Action<int, bool> onMouse)
    {
        _onKey = onKey;
        _onMouse = onMouse;
    }

    public void Listen(bool on)
    {
        lock (_gate)
        {
            if (on && _thread is null)
            {
                var ready = new ManualResetEventSlim();
                _thread = new Thread(() => Loop(ready)) { IsBackground = true, Name = "input-hook" };
                _thread.Start();
                ready.Wait(TimeSpan.FromSeconds(2));
            }
            else if (!on && _thread is not null)
            {
                Native.PostThreadMessage(_threadId, Native.WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
                _thread.Join(TimeSpan.FromSeconds(2));
                _thread = null;
            }
        }
    }

    private void Loop(ManualResetEventSlim ready)
    {
        _threadId = Native.GetCurrentThreadId();
        _proc = Callback;
        _mouseProc = MouseCallback;
        var module = Native.GetModuleHandle(null);
        var hook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, _proc, module, 0);
        var mouseHook = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, _mouseProc, module, 0);
        ready.Set();
        if (hook == IntPtr.Zero && mouseHook == IntPtr.Zero) return;
        while (Native.GetMessage(out _, IntPtr.Zero, 0, 0) > 0) { }
        if (hook != IntPtr.Zero) Native.UnhookWindowsHookEx(hook);
        if (mouseHook != IntPtr.Zero) Native.UnhookWindowsHookEx(mouseHook);
    }

    private IntPtr Callback(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            var message = (int)wParam;
            var down = message is Native.WM_KEYDOWN or Native.WM_SYSKEYDOWN;
            var up = message is Native.WM_KEYUP or Native.WM_SYSKEYUP;
            if (down || up)
            {
                var data = Marshal.PtrToStructure<Native.KbdLlHookStruct>(lParam);
                // Keys Murmur presses itself (paste, copy, a command) are not the person's.
                if (data.dwExtraInfo != Native.OwnInput) _onKey((int)data.vkCode, down);
            }
        }
        return Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    }

    /// <summary>Middle, back and forward buttons, numbered as the protocol does (2, 3 and 4).</summary>
    private IntPtr MouseCallback(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            var message = (int)wParam;
            var button = 0;
            if (message is Native.WM_MBUTTONDOWN or Native.WM_MBUTTONUP)
            {
                button = HotkeyEngine.MouseMiddle;
            }
            else if (message is Native.WM_XBUTTONDOWN or Native.WM_XBUTTONUP)
            {
                var data = Marshal.PtrToStructure<Native.MsLlHookStruct>(lParam);
                button = HotkeyEngine.XButton(data.mouseData);
            }
            if (button != 0) _onMouse(button, message is Native.WM_MBUTTONDOWN or Native.WM_XBUTTONDOWN);
        }
        return Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    }

    public void Dispose() => Listen(false);
}
