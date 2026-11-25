using System.Runtime.InteropServices;
using System.Text;

namespace Murmur.Helper.Windows;

/// <summary>What the clipboard held: every copyable format with its bytes, and whether something was lost.</summary>
public sealed record ClipboardSnapshot(IReadOnlyList<(uint Format, byte[] Data)> Items, bool Complete)
{
    /// <summary>The text on the clipboard, or null when there is none.</summary>
    public string? Text
    {
        get
        {
            foreach (var (format, data) in Items)
                if (format == Native.CF_UNICODETEXT) return Encoding.Unicode.GetString(data).TrimEnd('\0');
            return null;
        }
    }
}

/// <summary>The Win32 clipboard: save every copyable format, put them back, write text and HTML.</summary>
public static class WindowsClipboard
{
    public static readonly uint HtmlFormat = Native.RegisterClipboardFormat("HTML Format");

    public static bool Open()
    {
        for (var attempt = 0; attempt < 10; attempt++)
        {
            if (Native.OpenClipboard(IntPtr.Zero)) return true;
            Thread.Sleep(20);
        }
        return false;
    }

    /// <summary>Null when the clipboard cannot be opened. Empty and complete when it holds nothing.</summary>
    public static ClipboardSnapshot? Snapshot()
    {
        if (!Open()) return null;
        try
        {
            var formats = new List<uint>();
            for (var f = Native.EnumClipboardFormats(0); f != 0; f = Native.EnumClipboardFormats(f)) formats.Add(f);
            var items = new List<(uint, byte[])>();
            long total = 0;
            var complete = ClipboardPolicy.Lost(formats).Count == 0;
            foreach (var format in formats)
            {
                if (!ClipboardPolicy.IsCopyable(format)) continue;
                var handle = Native.GetClipboardData(format);
                if (handle == IntPtr.Zero) { complete = false; continue; }
                var size = (long)Native.GlobalSize(handle);
                total += size;
                if (total > ClipboardPolicy.MaxBytes) return new ClipboardSnapshot(Array.Empty<(uint, byte[])>(), false);
                var pointer = Native.GlobalLock(handle);
                if (pointer == IntPtr.Zero) { complete = false; continue; }
                try
                {
                    var bytes = new byte[size];
                    Marshal.Copy(pointer, bytes, 0, bytes.Length);
                    items.Add((format, bytes));
                }
                finally { Native.GlobalUnlock(handle); }
            }
            return new ClipboardSnapshot(items, complete);
        }
        finally { Native.CloseClipboard(); }
    }

    /// <summary>Replaces the clipboard with the saved formats. False when it cannot be opened.</summary>
    public static bool Restore(ClipboardSnapshot snapshot)
    {
        if (!Open()) return false;
        try
        {
            Native.EmptyClipboard();
            foreach (var (format, data) in snapshot.Items) Put(format, data);
            return true;
        }
        finally { Native.CloseClipboard(); }
    }

    public static void WriteText(string text, string? html)
    {
        if (!Open()) throw new HelperException(ErrorCode.PasteFailed, "The clipboard is in use by another program.");
        try
        {
            Native.EmptyClipboard();
            Put(Native.CF_UNICODETEXT, Encoding.Unicode.GetBytes(text + "\0"));
            if (html is not null && HtmlFormat != 0) Put(HtmlFormat, Encoding.UTF8.GetBytes(CfHtml.Build(html) + "\0"));
        }
        finally { Native.CloseClipboard(); }
    }

    public static void Put(uint format, byte[] bytes)
    {
        var memory = Native.GlobalAlloc(Native.GMEM_MOVEABLE, (UIntPtr)bytes.Length);
        var pointer = Native.GlobalLock(memory);
        Marshal.Copy(bytes, 0, pointer, bytes.Length);
        Native.GlobalUnlock(memory);
        // After a successful call the clipboard owns the memory.
        if (Native.SetClipboardData(format, memory) == IntPtr.Zero) Native.GlobalFree(memory);
    }
}
