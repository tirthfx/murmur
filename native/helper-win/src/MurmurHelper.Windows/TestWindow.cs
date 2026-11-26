using System.Runtime.InteropServices;

namespace Murmur.Helper.Windows;

/// <summary>A throwaway edit box on its own thread, for the self-test to read and type into.</summary>
internal sealed class TestWindow : IDisposable
{
    private const uint Overlapped = 0x00CF0000, Visible = 0x10000000, Password = 0x0020, AutoHScroll = 0x0080;
    private const uint SetSel = 0x00B1, GetSel = 0x00B0;

    private readonly Thread _thread;
    private readonly ManualResetEventSlim _ready = new();
    private uint _threadId;

    public IntPtr Handle { get; private set; }

    public TestWindow(string text, bool password = false)
    {
        _thread = new Thread(() =>
        {
            _threadId = Native.GetCurrentThreadId();
            var style = Overlapped | Visible | AutoHScroll | (password ? Password : 0);
            Handle = Native.CreateWindowEx(0, "EDIT", text, style, 40, 40, 420, 120, IntPtr.Zero, IntPtr.Zero, Native.GetModuleHandle(null), IntPtr.Zero);
            _ready.Set();
            while (Native.GetMessage(out var message, IntPtr.Zero, 0, 0) > 0)
            {
                Native.TranslateMessage(ref message);
                Native.DispatchMessage(ref message);
            }
            if (Handle != IntPtr.Zero) Native.DestroyWindow(Handle);
        }) { IsBackground = true };
        _thread.Start();
        _ready.Wait(TimeSpan.FromSeconds(5));
        if (Handle == IntPtr.Zero) throw new InvalidOperationException("the test window was not made");
    }

    public void Select(int start, int end) => Native.SendMessage(Handle, SetSel, (IntPtr)start, (IntPtr)end);

    public (int Start, int End) Selection()
    {
        var packed = (long)Native.SendMessage(Handle, GetSel, IntPtr.Zero, IntPtr.Zero);
        return ((int)(packed & 0xFFFF), (int)((packed >> 16) & 0xFFFF));
    }

    /// <summary>Asks Windows to bring the box forward; false when this session does not allow it.</summary>
    public bool Focus()
    {
        for (var attempt = 0; attempt < 10; attempt++)
        {
            Native.SetForegroundWindow(Handle);
            Thread.Sleep(100);
            if (Native.GetForegroundWindow() == Handle) return true;
        }
        return false;
    }

    public void Dispose()
    {
        Native.PostThreadMessage(_threadId, Native.WM_QUIT, UIntPtr.Zero, IntPtr.Zero);
        _thread.Join(TimeSpan.FromSeconds(5));
    }
}
