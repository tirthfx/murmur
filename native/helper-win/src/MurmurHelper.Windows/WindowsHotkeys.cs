using System.Runtime.InteropServices;

namespace Murmur.Helper.Windows;

/// <summary>
/// The low-level keyboard hook, on its own thread with a message loop. It only reports key
/// changes to the <see cref="HotkeyEngine"/> and returns at once: the engine does the work, and
/// the hook never swallows a key. It runs only while at least one binding is set.
/// </summary>
public sealed class WindowsKeyboardHook : IDisposable
{
    private readonly Action<int, bool> _onKey;
    private readonly object _gate = new();
    private Thread? _thread;
    private uint _threadId;
    private Native.HookProc? _proc; // kept so it is not collected while installed

    public WindowsKeyboardHook(Action<int, bool> onKey) => _onKey = onKey;

    public void Listen(bool on)
    {
        lock (_gate)
        {
            if (on && _thread is null)
            {
                var ready = new ManualResetEventSlim();
                _thread = new Thread(() => Loop(ready)) { IsBackground = true, Name = "keyboard-hook" };
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
        var hook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, _proc, Native.GetModuleHandle(null), 0);
        ready.Set();
        if (hook == IntPtr.Zero) return;
        while (Native.GetMessage(out _, IntPtr.Zero, 0, 0) > 0) { }
        Native.UnhookWindowsHookEx(hook);
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
                _onKey((int)data.vkCode, down);
            }
        }
        return Native.CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    }

    public void Dispose() => Listen(false);
}
