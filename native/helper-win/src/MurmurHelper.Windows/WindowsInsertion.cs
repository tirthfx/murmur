using System.Runtime.InteropServices;
using System.Text;

namespace Murmur.Helper.Windows;

/// <summary>
/// Pastes with the clipboard and Ctrl+V, or types with Unicode key events. The clipboard is saved
/// and restored for text only: if it held anything else (an image, files), that cannot be put
/// back faithfully, so it is left as Murmur's text and the result says it was not restored.
/// </summary>
public sealed class WindowsInsertion : IInsertionPlatform
{
    private readonly uint _htmlFormat = Native.RegisterClipboardFormat("HTML Format");

    public string? FrontProcessName()
    {
        var hwnd = Native.GetForegroundWindow();
        return hwnd == IntPtr.Zero ? null : Native.ProcessNameOf(hwnd, out _);
    }

    public bool? Paste(string text, string? html, bool restore, int restoreDelayMs)
    {
        var saved = restore ? ReadClipboard() : null;
        WriteClipboard(text, html);
        Keys(Native.VK_CONTROL, down: true);
        Keys(Native.VK_V, down: true);
        Keys(Native.VK_V, down: false);
        Keys(Native.VK_CONTROL, down: false);
        if (!restore) return null;
        Thread.Sleep(Math.Max(restoreDelayMs, 50));
        if (saved is null) return false;
        // Another program may have changed the clipboard meanwhile; then it is left alone.
        if (ReadClipboard()?.Text != text) return false;
        WriteClipboard(saved.Text, null);
        return true;
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

    public void Copy(string text) => WriteClipboard(text, null);

    private sealed record Saved(string Text);

    private Saved? ReadClipboard()
    {
        if (!Open()) return null;
        try
        {
            var formats = 0;
            for (var f = Native.EnumClipboardFormats(0); f != 0; f = Native.EnumClipboardFormats(f)) formats++;
            if (formats == 0) return new Saved("");
            var handle = Native.GetClipboardData(Native.CF_UNICODETEXT);
            if (handle == IntPtr.Zero) return null; // not text: cannot be restored
            var pointer = Native.GlobalLock(handle);
            if (pointer == IntPtr.Zero) return null;
            try { return new Saved(Marshal.PtrToStringUni(pointer) ?? ""); }
            finally { Native.GlobalUnlock(handle); }
        }
        finally { Native.CloseClipboard(); }
    }

    private void WriteClipboard(string text, string? html)
    {
        if (!Open()) throw new HelperException(ErrorCode.PasteFailed, "The clipboard is in use by another program.");
        try
        {
            Native.EmptyClipboard();
            Put(Native.CF_UNICODETEXT, Encoding.Unicode.GetBytes(text + "\0"));
            if (html is not null && _htmlFormat != 0) Put(_htmlFormat, Encoding.UTF8.GetBytes(CfHtml.Build(html) + "\0"));
        }
        finally { Native.CloseClipboard(); }
    }

    private static bool Open()
    {
        for (var attempt = 0; attempt < 10; attempt++)
        {
            if (Native.OpenClipboard(IntPtr.Zero)) return true;
            Thread.Sleep(20);
        }
        return false;
    }

    private static void Put(uint format, byte[] bytes)
    {
        var memory = Native.GlobalAlloc(Native.GMEM_MOVEABLE, (UIntPtr)bytes.Length);
        var pointer = Native.GlobalLock(memory);
        Marshal.Copy(bytes, 0, pointer, bytes.Length);
        Native.GlobalUnlock(memory);
        // After a successful call the clipboard owns the memory.
        if (Native.SetClipboardData(format, memory) == IntPtr.Zero) Native.GlobalFree(memory);
    }

    private static void Keys(ushort vk, bool down)
    {
        var input = new Native.Input { type = Native.INPUT_KEYBOARD, ki = new Native.KeybdInput { wVk = vk, dwFlags = down ? 0 : Native.KEYEVENTF_KEYUP } };
        Native.SendInput(1, new[] { input }, Marshal.SizeOf<Native.Input>());
    }

    private static Native.Input Unicode(ushort unit, bool up) => new()
    {
        type = Native.INPUT_KEYBOARD,
        ki = new Native.KeybdInput { wScan = unit, dwFlags = Native.KEYEVENTF_UNICODE | (up ? Native.KEYEVENTF_KEYUP : 0) },
    };
}
