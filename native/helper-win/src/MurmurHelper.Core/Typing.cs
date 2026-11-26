namespace Murmur.Helper;

/// <summary>
/// Counts typed words from key presses alone (DC-08). Only key codes are looked at, and only to
/// tell a separator (space, Enter, Tab) from a key that types something; no character is read,
/// kept or sent.
/// </summary>
public sealed class TypingCounter
{
    private int _words;
    private bool _inWord;

    /// <summary>Letters, digits, the number pad, punctuation, and keys an input method or another keyboard sends.</summary>
    private static bool Types(int vk) =>
        vk is >= 0x30 and <= 0x39 or >= 0x41 and <= 0x5A or >= 0x60 and <= 0x6F
            or >= 0xBA and <= 0xC0 or >= 0xDB and <= 0xDF or 0xE2 or 0xE5 or 0xE7;

    private static bool Separates(int vk) => vk is 0x20 or 0x0D or 0x09;

    /// <summary>One key going down, not a repeat. Alt Gr is Control and Alt together, and types.</summary>
    public void KeyDown(int vk, bool control, bool alt, bool windows)
    {
        // Shortcuts are not typing.
        if (windows || control != alt) return;
        if (Separates(vk))
        {
            if (_inWord) _words++;
            _inWord = false;
        }
        else if (Types(vk))
        {
            _inWord = true;
        }
    }

    /// <summary>The words counted since the last call, and a fresh start.</summary>
    public int Take()
    {
        var count = _words;
        _words = 0;
        return count;
    }
}
