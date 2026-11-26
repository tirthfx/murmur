using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>One shortcut on Windows: a virtual key and the modifiers held with it.</summary>
public sealed record KeyStroke(int Key, bool Control = false, bool Shift = false, bool Alt = false);

/// <summary>One key going down or up, as sent to Windows.</summary>
public sealed record KeyChange(int Key, bool Down, bool Extended);

/// <summary>
/// The keys Murmur may press in another app. Main names them as on the Mac (the shared
/// <c>keyComboAllowed</c> rule); <see cref="Translate"/> gives the Windows shortcut that does the same.
/// </summary>
public static class KeyCombos
{
    public const int Back = 0x08, Return = 0x0D, Insert = 0x2D, Home = 0x24, End = 0x23;
    public const int Left = 0x25, Up = 0x26, Right = 0x27, Down = 0x28;
    public const int Shift = 0x10, Control = 0x11, Alt = 0x12;

    private static readonly string[] Names = { "b", "i", "a", "z", "return", "left", "right", "up", "down", "left_bracket", "delete" };
    private static readonly string[] Modifiers = { "command", "shift", "option", "control" };

    public static bool Allowed(string key, IReadOnlySet<string> modifiers) => key switch
    {
        "b" or "i" or "a" or "left_bracket" => modifiers.SetEquals(new[] { "command" }),
        "z" => modifiers.Contains("command") && !modifiers.Contains("option") && !modifiers.Contains("control"),
        "return" => modifiers.Count == 0 || modifiers.SetEquals(new[] { "shift" }),
        "delete" => modifiers.Count == 0,
        "left" or "right" or "up" or "down" => !modifiers.Contains("control"),
        _ => false,
    };

    public static KeyStroke Translate(string key, IReadOnlySet<string> modifiers)
    {
        var command = modifiers.Contains("command");
        var option = modifiers.Contains("option");
        var shift = modifiers.Contains("shift");
        return key switch
        {
            "b" => new KeyStroke('B', Control: true),
            "i" => new KeyStroke('I', Control: true),
            "a" => new KeyStroke('A', Control: true),
            // Redo is Ctrl+Y in most Windows programs.
            "z" => new KeyStroke(shift ? 'Y' : 'Z', Control: true),
            // Browser back.
            "left_bracket" => new KeyStroke(Left, Alt: true),
            "return" => new KeyStroke(Return, Shift: shift),
            // The Mac's Delete key deletes backwards.
            "delete" => new KeyStroke(Back),
            // Command moves to the line or document edge, Option by word.
            "left" => command ? new KeyStroke(Home, Shift: shift) : new KeyStroke(Left, Control: option, Shift: shift),
            "right" => command ? new KeyStroke(End, Shift: shift) : new KeyStroke(Right, Control: option, Shift: shift),
            "up" => command ? new KeyStroke(Home, Control: true, Shift: shift) : new KeyStroke(Up, Control: option, Shift: shift),
            "down" => command ? new KeyStroke(End, Control: true, Shift: shift) : new KeyStroke(Down, Control: option, Shift: shift),
            _ => throw new HelperException(ErrorCode.InvalidPayload, "key is not on the allowed list"),
        };
    }

    /// <summary>Keys on the navigation block; without the extended flag Shift+arrow selects nothing with Num Lock on.</summary>
    public static bool IsExtended(int key) => key is Left or Up or Right or Down or Home or End or Insert or 0xA3 or 0xA5 or 0x5B or 0x5C;

    /// <summary>
    /// The changes that type a shortcut while the person may still be holding keys. The wanted
    /// modifiers go down first, then any other held modifier is released (with Control down, so
    /// letting go of Alt or the Windows key opens no menu), then the key.
    /// </summary>
    public static IReadOnlyList<KeyChange> Sequence(KeyStroke stroke, IReadOnlyCollection<int> held)
    {
        static int Family(int key) => key switch
        {
            0xA0 or 0xA1 or Shift => Shift,
            0xA2 or 0xA3 or Control => Control,
            0xA4 or 0xA5 or Alt => Alt,
            _ => key,
        };
        var wanted = new List<int>();
        if (stroke.Control) wanted.Add(Control);
        if (stroke.Shift) wanted.Add(Shift);
        if (stroke.Alt) wanted.Add(Alt);
        var release = held.Where(key => !wanted.Contains(Family(key))).ToList();
        // Control is needed to release Alt or Windows quietly, even when the shortcut has none.
        var mask = release.Any(key => Family(key) is not (Shift or Control)) && !wanted.Contains(Control) && !held.Any(k => Family(k) == Control);

        var changes = new List<KeyChange>();
        void Press(int key, bool down) => changes.Add(new KeyChange(key, down, IsExtended(key)));
        if (mask) Press(Control, true);
        foreach (var key in wanted) Press(key, true);
        foreach (var key in release.OrderBy(key => Family(key) == Control ? 1 : 0)) Press(key, false);
        if (mask) Press(Control, false);
        Press(stroke.Key, true);
        Press(stroke.Key, false);
        foreach (var key in Enumerable.Reverse(wanted)) Press(key, false);
        return changes;
    }

    /// <summary>Reads and checks a <c>keys.press</c> request.</summary>
    public static (KeyStroke Stroke, int Repeat, string? OnlyInApp) Parse(JsonObject p)
    {
        var key = Payload.Str(p, "key");
        if (!Names.Contains(key)) throw new HelperException(ErrorCode.InvalidPayload, "key is not on the allowed list");
        var modifiers = new HashSet<string>();
        foreach (var name in Payload.Strings(p, "modifiers"))
        {
            if (!Modifiers.Contains(name) || !modifiers.Add(name))
                throw new HelperException(ErrorCode.InvalidPayload, "Unknown or repeated modifier");
        }
        if (!Allowed(key, modifiers)) throw new HelperException(ErrorCode.InvalidPayload, "This key combination is not allowed");
        var repeat = p.ContainsKey("repeat") ? Payload.Int(p, "repeat") : 1;
        if (repeat is < 1 or > 200) throw new HelperException(ErrorCode.InvalidPayload, "repeat must be from 1 to 200");
        return (Translate(key, modifiers), repeat, Payload.TryStr(p, "onlyInApp"));
    }
}

public interface IKeyboardPlatform
{
    string? FrontProcessName();

    /// <summary>Types the shortcut once. False when Windows did not accept the keys.</summary>
    bool Press(KeyStroke stroke);
}

/// <summary><c>keys.press</c> (RW-09, RW-13).</summary>
public sealed class KeysController(IKeyboardPlatform platform)
{
    public JsonObject Press(JsonObject p)
    {
        var (stroke, repeat, onlyInApp) = KeyCombos.Parse(p);
        var app = platform.FrontProcessName();
        if (onlyInApp is not null && !string.Equals(onlyInApp, app, StringComparison.OrdinalIgnoreCase))
            return new JsonObject { ["pressed"] = false, ["appBundleId"] = app };
        for (var i = 0; i < repeat; i++)
        {
            if (!platform.Press(stroke))
                throw new HelperException(ErrorCode.PasteFailed, "Key events could not be posted. A program running as administrator does not take input from Murmur.");
        }
        return new JsonObject { ["pressed"] = true, ["appBundleId"] = app };
    }
}
