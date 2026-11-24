using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace Murmur.Helper.Windows;

/// <summary>Microphone consent from the privacy settings. Windows has no prompts for the rest, so they are granted.</summary>
public sealed class WindowsPermissions : IPermissionProvider
{
    private const string Consent = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";

    public string Status(string kind)
    {
        if (kind != "microphone") return "granted";
        // The per-app value (for a desktop program) wins over the global one.
        foreach (var path in new[] { Consent + @"\NonPackaged", Consent })
        {
            using var key = Registry.CurrentUser.OpenSubKey(path);
            if (key?.GetValue("Value") is string value)
                return value.Equals("Allow", StringComparison.OrdinalIgnoreCase) ? "granted" : "denied";
        }
        return "unknown";
    }

    public bool Request(string kind)
    {
        if (kind != "microphone" || Status(kind) == "granted") return false;
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ms-settings:privacy-microphone") { UseShellExecute = true });
            return true;
        }
        catch { return false; }
    }
}

/// <summary>Credential Manager. An item is named <c>service:account</c> and keeps the account as its user name.</summary>
public sealed class WindowsSecureStore : ISecureStore
{
    private const uint Generic = 1, PersistLocalMachine = 2;
    private static string Target(string service, string account) => $"{service}:{account}";

    public string? Get(string service, string account)
    {
        if (!Native.CredRead(Target(service, account), Generic, 0, out var pointer))
        {
            var error = Marshal.GetLastWin32Error();
            if (error == 1168) return null; // ERROR_NOT_FOUND
            throw new HelperException(ErrorCode.KeychainFailed, $"Credential Manager failed ({error}).");
        }
        try
        {
            var credential = Marshal.PtrToStructure<Native.Credential>(pointer);
            return credential.CredentialBlobSize == 0 ? "" : Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2);
        }
        finally { Native.CredFree(pointer); }
    }

    public void Set(string service, string account, string value)
    {
        var blob = Marshal.StringToCoTaskMemUni(value);
        try
        {
            var credential = new Native.Credential
            {
                Type = Generic,
                TargetName = Target(service, account),
                UserName = account,
                CredentialBlob = blob,
                CredentialBlobSize = (uint)(value.Length * 2),
                Persist = PersistLocalMachine,
            };
            if (!Native.CredWrite(ref credential, 0))
                throw new HelperException(ErrorCode.KeychainFailed, $"Credential Manager failed ({Marshal.GetLastWin32Error()}).");
        }
        finally { Marshal.FreeCoTaskMem(blob); }
    }

    public bool Delete(string service, string account)
    {
        if (Native.CredDelete(Target(service, account), Generic, 0)) return true;
        var error = Marshal.GetLastWin32Error();
        if (error == 1168) return false;
        throw new HelperException(ErrorCode.KeychainFailed, $"Credential Manager failed ({error}).");
    }
}

/// <summary>Windows asks nothing of the person to read the front window, so there is no state to keep.</summary>
internal static class Windows
{
    public static FrontAppInfo? Front()
    {
        var hwnd = Native.GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return null;
        var name = Native.ProcessNameOf(hwnd, out var pid);
        return new FrontAppInfo(name, Native.TitleOf(hwnd), pid);
    }

    public static IEnumerable<WindowInfo> VisibleWindows()
    {
        var found = new List<WindowInfo>();
        Native.EnumWindows((hwnd, unused) =>
        {
            if (!Native.IsWindowVisible(hwnd)) return true;
            var title = Native.TitleOf(hwnd);
            if (title.Length == 0) return true;
            var name = Native.ProcessNameOf(hwnd, out _);
            if (name is not null) found.Add(new WindowInfo(name, title));
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
