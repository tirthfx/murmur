using System.Runtime.InteropServices;
using System.Text;

namespace Murmur.Helper.Windows;

/// <summary>
/// Pastes with the clipboard and Ctrl+V, or types with Unicode key events. Every copyable clipboard
/// format (text, HTML, file lists, bitmaps, what apps registered) is saved and put back. If the
/// clipboard held a format that cannot be copied (see <see cref="ClipboardPolicy"/>), the rest is
/// put back and the result says it was not fully restored.
/// </summary>
public sealed class WindowsInsertion : IInsertionPlatform
{
    public string? FrontProcessName()
    {
        var hwnd = Native.GetForegroundWindow();
        return hwnd == IntPtr.Zero ? null : Native.ProcessNameOf(hwnd, out _);
    }

    public bool? Paste(string text, string? html, bool restore, int restoreDelayMs)
    {
        var saved = restore ? WindowsClipboard.Snapshot() : null;
        WindowsClipboard.WriteText(text, html);
        Keys(Native.VK_CONTROL, down: true);
        Keys(Native.VK_V, down: true);
        Keys(Native.VK_V, down: false);
        Keys(Native.VK_CONTROL, down: false);
        if (!restore) return null;
        Thread.Sleep(Math.Max(restoreDelayMs, 50));
        if (saved is null) return false;
        // Another program may have changed the clipboard meanwhile; then it is left alone.
        if (WindowsClipboard.Snapshot()?.Text != text) return false;
        return WindowsClipboard.Restore(saved) && saved.Complete;
    }

    public void Type(string text)
    {
        var inputs = new List<Native.Input>();
        foreach (var unit in text)
        {
            var scan = unit == '\n' ? (ushort)'\r' : unit;
            inputs.Add(Unicode(scan, up: false));
            inputs.Add(Unicode(scan, up: true));
        }
        for (var i = 0; i < inputs.Count; i += 200)
        {
            var batch = inputs.Skip(i).Take(200).ToArray();
            if (Native.SendInput((uint)batch.Length, batch, Marshal.SizeOf<Native.Input>()) != batch.Length)
                throw new HelperException(ErrorCode.PasteFailed, "The keys were not accepted. A program running as administrator does not take input from Murmur.");
        }
    }

    public void PressEnter()
    {
        Keys(Native.VK_RETURN, down: true);
        Keys(Native.VK_RETURN, down: false);
    }

    public void Copy(string text) => WindowsClipboard.WriteText(text, null);

    private static void Keys(ushort vk, bool down)
    {
        var input = new Native.Input { type = Native.INPUT_KEYBOARD, ki = new Native.KeybdInput { wVk = vk, dwFlags = down ? 0 : Native.KEYEVENTF_KEYUP, dwExtraInfo = Native.OwnInput } };
        Native.SendInput(1, new[] { input }, Marshal.SizeOf<Native.Input>());
    }

    private static Native.Input Unicode(ushort unit, bool up) => new()
    {
        type = Native.INPUT_KEYBOARD,
        ki = new Native.KeybdInput { wScan = unit, dwFlags = Native.KEYEVENTF_UNICODE | (up ? Native.KEYEVENTF_KEYUP : 0), dwExtraInfo = Native.OwnInput },
    };
}
