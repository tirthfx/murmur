using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace Murmur.Helper.Windows;

/// <summary>The process table through the Tool Help snapshot, and the app in front.</summary>
public sealed class WindowsProcesses : IProcessTable
{
    public int? FrontProcessId()
    {
        var hwnd = Native.GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return null;
        Native.GetWindowThreadProcessId(hwnd, out var pid);
        return pid == 0 ? null : (int)pid;
    }

    public IReadOnlyList<ProcessRow> Rows()
    {
        var rows = new List<ProcessRow>();
        var snapshot = Native.CreateToolhelp32Snapshot(Native.TH32CS_SNAPPROCESS, 0);
        if (snapshot == new IntPtr(-1)) return rows;
        try
        {
            var entry = new Native.ProcessEntry { Size = (uint)Marshal.SizeOf<Native.ProcessEntry>() };
            for (var more = Native.Process32First(snapshot, ref entry); more; more = Native.Process32Next(snapshot, ref entry))
                rows.Add(new ProcessRow((int)entry.ProcessId, (int)entry.ParentProcessId, entry.ExeFile));
        }
        finally { Native.CloseHandle(snapshot); }
        return rows;
    }

    public string? CommandLine(int pid)
    {
        var process = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)pid);
        if (process == IntPtr.Zero) return null;
        try
        {
            // ProcessCommandLineInformation: a UNICODE_STRING followed by its characters.
            const int commandLine = 60;
            Native.NtQueryInformationProcess(process, commandLine, IntPtr.Zero, 0, out var needed);
            if (needed <= 0 || needed > 1 << 17) return null;
            var buffer = Marshal.AllocHGlobal(needed);
            try
            {
                if (Native.NtQueryInformationProcess(process, commandLine, buffer, needed, out _) != 0) return null;
                var bytes = (ushort)Marshal.ReadInt16(buffer);
                var text = Marshal.ReadIntPtr(buffer, IntPtr.Size); // after Length and MaximumLength, aligned
                return text == IntPtr.Zero ? null : Marshal.PtrToStringUni(text, bytes / 2);
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        finally { Native.CloseHandle(process); }
    }
}

/// <summary>
/// Brings a program's window forward. Windows lets only the program in front do that, so the
/// helper joins its input to the front window's for the call.
/// </summary>
public sealed class WindowsActivator : IAppActivator
{
    public bool Activate(string processName)
    {
        var target = IntPtr.Zero;
        // Windows are listed front to back, so the first match is the one used last.
        Native.EnumWindows((hwnd, unused) =>
        {
            if (!Native.IsWindowVisible(hwnd) || Native.TitleOf(hwnd).Length == 0) return true;
            if (!string.Equals(Native.ProcessNameOf(hwnd, out _), processName, StringComparison.OrdinalIgnoreCase)) return true;
            target = hwnd;
            return false;
        }, IntPtr.Zero);
        return target != IntPtr.Zero && BringForward(target);
    }

    internal static bool BringForward(IntPtr target)
    {
        if (Native.IsIconic(target)) Native.ShowWindow(target, Native.SW_RESTORE);
        var front = Native.GetForegroundWindow();
        if (front == target) return true;
        var mine = Native.GetCurrentThreadId();
        var theirs = front == IntPtr.Zero ? 0 : Native.GetWindowThreadProcessId(front, out _);
        var joined = theirs != 0 && theirs != mine && Native.AttachThreadInput(mine, theirs, true);
        try
        {
            Native.BringWindowToTop(target);
            Native.SetForegroundWindow(target);
        }
        finally
        {
            if (joined) Native.AttachThreadInput(mine, theirs, false);
        }
        return Native.GetForegroundWindow() == target;
    }
}

/// <summary>The programs the Start menu starts, for the person and for everyone on the PC.</summary>
public sealed class WindowsInstalledApps : IInstalledApps
{
    public IEnumerable<InstalledApp> List()
    {
        var apps = new List<InstalledApp>();
        // The shell's shortcut object wants a single-threaded apartment.
        var thread = new Thread(() =>
        {
            foreach (var folder in new[] { Environment.SpecialFolder.CommonPrograms, Environment.SpecialFolder.Programs })
                Read(Environment.GetFolderPath(folder), apps);
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        return apps;
    }

    private static void Read(string root, List<InstalledApp> into)
    {
        if (root.Length == 0 || !Directory.Exists(root)) return;
        var options = new EnumerationOptions { RecurseSubdirectories = true, IgnoreInaccessible = true };
        foreach (var file in Directory.EnumerateFiles(root, "*.lnk", options))
        {
            if (into.Count >= 4 * AppCatalog.MaxApps) return;
            try
            {
                var link = (Native.IShellLink)new Native.ShellLink();
                try
                {
                    ((IPersistFile)link).Load(file, 0);
                    var target = new StringBuilder(1024);
                    link.GetPath(target, target.Capacity, IntPtr.Zero, 0);
                    var name = Path.GetFileName(target.ToString());
                    if (name.Length > 0) into.Add(new InstalledApp(name, Path.GetFileNameWithoutExtension(file)));
                }
                finally { Marshal.ReleaseComObject(link); }
            }
            catch (Exception error) when (error is COMException or IOException or UnauthorizedAccessException)
            {
                // A broken shortcut is not an app.
            }
        }
    }
}
