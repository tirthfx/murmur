using System.Runtime.InteropServices;

namespace Murmur.Helper.Windows;

/// <summary>Types a shortcut with <c>SendInput</c>, letting go of modifiers the person still holds.</summary>
public sealed class WindowsKeys : IKeyboardPlatform
{
    // Left and right Shift, Control, Alt and Windows.
    private static readonly int[] Modifiers = { 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C };

    public string? FrontProcessName()
    {
        var hwnd = Native.GetForegroundWindow();
        return hwnd == IntPtr.Zero ? null : Native.ProcessNameOf(hwnd, out _);
    }

    public bool Press(KeyStroke stroke)
    {
        var held = Modifiers.Where(key => (Native.GetAsyncKeyState(key) & 0x8000) != 0).ToList();
        var inputs = KeyCombos.Sequence(stroke, held).Select(change => new Native.Input
        {
            type = Native.INPUT_KEYBOARD,
            ki = new Native.KeybdInput
            {
                wVk = (ushort)change.Key,
                dwFlags = (change.Down ? 0 : Native.KEYEVENTF_KEYUP) | (change.Extended ? Native.KEYEVENTF_EXTENDEDKEY : 0),
                dwExtraInfo = Native.OwnInput,
            },
        }).ToArray();
        return Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<Native.Input>()) == inputs.Length;
    }
}
