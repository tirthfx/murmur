using System.Runtime.InteropServices;

namespace Murmur.Helper.Windows;

/// <summary>The Win32 calls the helper makes. Nothing else in the helper touches the OS directly.</summary>
internal static class Native
{
    public const int WH_KEYBOARD_LL = 13;
    public const int WH_MOUSE_LL = 14;
    public const int WM_MBUTTONDOWN = 0x207, WM_MBUTTONUP = 0x208, WM_XBUTTONDOWN = 0x20B, WM_XBUTTONUP = 0x20C;
    public const int WM_KEYDOWN = 0x0100, WM_KEYUP = 0x0101, WM_SYSKEYDOWN = 0x0104, WM_SYSKEYUP = 0x0105, WM_QUIT = 0x0012;
    public const uint INPUT_KEYBOARD = 1, KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004;
    public const ushort VK_CONTROL = 0x11, VK_RETURN = 0x0D, VK_V = 0x56;
    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
    /// <summary>Marks the key events Murmur sends, so its own hooks do not act on them.</summary>
    public static readonly UIntPtr OwnInput = (UIntPtr)0x4D55524Du;
    public const uint CF_UNICODETEXT = 13, GMEM_MOVEABLE = 0x0002;
    public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    public const uint TH32CS_SNAPPROCESS = 0x2;
    public const int SW_RESTORE = 9;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct ProcessEntry
    {
        public uint Size, Usage, ProcessId;
        public IntPtr DefaultHeapId;
        public uint ModuleId, Threads, ParentProcessId;
        public int PriorityClassBase;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string ExeFile;
    }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    public class ShellLink { }

    // Only the first method is called, so the rest of the interface is not declared.
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    public interface IShellLink
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder file, int capacity, IntPtr findData, uint flags);
    }

    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "Process32FirstW")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, EntryPoint = "Process32NextW")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr CreateWindowEx(uint exStyle, string className, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool DestroyWindow(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool TranslateMessage(ref Msg message);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr DispatchMessage(ref Msg message);
    [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool SetWindowText(IntPtr hwnd, string text);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool AttachThreadInput(uint thread, uint other, bool attach);
    [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr process, int kind, IntPtr buffer, int length, out int needed);

    public delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct MsLlHookStruct { public int x, y; public uint mouseData, flags, time; public UIntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    public struct KbdLlHookStruct { public uint vkCode, scanCode, flags, time; public UIntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    public struct Msg { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int x, y; }

    [StructLayout(LayoutKind.Sequential)]
    public struct KeybdInput { public ushort wVk, wScan; public uint dwFlags, time; public UIntPtr dwExtraInfo; }

    // INPUT is a union; the mouse member is the largest, so the struct is padded to its size.
    [StructLayout(LayoutKind.Explicit, Size = 40)]
    public struct Input
    {
        [FieldOffset(0)] public uint type;
        [FieldOffset(8)] public KeybdInput ki;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Credential
    {
        public uint Flags, Type;
        public string TargetName, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string? TargetAlias, UserName;
    }

    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetWindowsHookEx(int idHook, HookProc proc, IntPtr module, uint threadId);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetMessage(out Msg msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool PostThreadMessage(uint threadId, uint msg, UIntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, char[] text, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EnumWindows(EnumWindowsProc proc, IntPtr lParam);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CloseClipboard();
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool EmptyClipboard();
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetClipboardData(uint format, IntPtr handle);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr GetClipboardData(uint format);
    [DllImport("user32.dll", SetLastError = true)] public static extern uint EnumClipboardFormats(uint format);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("kernel32.dll")] public static extern IntPtr GetModuleHandle(string? name);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, char[] name, ref uint size);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
    [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GlobalUnlock(IntPtr handle);
    [DllImport("kernel32.dll")] public static extern UIntPtr GlobalSize(IntPtr handle);
    [DllImport("kernel32.dll")] public static extern IntPtr GlobalFree(IntPtr handle);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CredWrite(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CredDelete(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr buffer);

    /// <summary>The process image name (<c>chrome.exe</c>) of a window, or null.</summary>
    public static string? ProcessNameOf(IntPtr hwnd, out int pid)
    {
        GetWindowThreadProcessId(hwnd, out var id);
        pid = (int)id;
        return id == 0 ? null : Path.GetFileName(ProcessPathOf(id));
    }

    /// <summary>The full path of a process's program, or null.</summary>
    public static string? ProcessPathOf(uint id)
    {
        var process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, id);
        if (process == IntPtr.Zero) return null;
        try
        {
            var buffer = new char[1024];
            var size = (uint)buffer.Length;
            return QueryFullProcessImageName(process, 0, buffer, ref size) ? new string(buffer, 0, (int)size) : null;
        }
        finally { CloseHandle(process); }
    }

    public static string TitleOf(IntPtr hwnd)
    {
        var buffer = new char[512];
        var length = GetWindowText(hwnd, buffer, buffer.Length);
        return length > 0 ? new string(buffer, 0, length) : "";
    }
}
