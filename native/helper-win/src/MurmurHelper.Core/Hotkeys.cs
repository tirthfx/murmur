using System.Text.Json.Nodes;

namespace Murmur.Helper;

public sealed record HotkeyBinding(
    string Id,
    string Action,
    string TriggerType,
    int KeyCode,
    IReadOnlyList<string> Modifiers,
    string Mode,
    string? RewriteId,
    bool Exclusive)
{
    public static HotkeyBinding Parse(JsonObject json)
    {
        var trigger = json["trigger"] as JsonObject ?? throw new HelperException(ErrorCode.InvalidPayload, "binding needs a trigger");
        var type = Payload.TryStr(trigger, "type") ?? "key";
        return new HotkeyBinding(
            Payload.Str(json, "id"),
            Payload.Str(json, "action"),
            type,
            type == "key" ? Payload.Int(trigger, "keyCode") : Payload.TryInt(trigger, "button") ?? -1,
            Payload.Strings(trigger, "modifiers"),
            Payload.Str(json, "mode"),
            Payload.TryStr(json, "rewriteId"),
            Payload.TryBool(json, "exclusive") ?? false);
    }
}

public sealed record HotkeyRejection(string Id, string Code, string Message);

public sealed record HotkeyConfigureResult(IReadOnlyList<string> Registered, IReadOnlyList<HotkeyRejection> Rejected);

/// <summary>
/// Turns key presses into hotkey events (the Windows counterpart of the Mac event tap). It only
/// listens: it never swallows a key. On Windows the key codes are virtual-key codes, and the
/// left and right Shift, Control, Alt and Windows keys count as one key each.
/// </summary>
public sealed class HotkeyEngine : IHotkeyService
{
    public const int Shift = 0x10, Control = 0x11, Alt = 0x12, Windows = 0x5B;
    public const int MaxBindings = 64;

    /// <summary>Mouse buttons in the protocol's numbering (middle, then the two side buttons) that Windows reports.</summary>
    public const int MouseMiddle = 2, MouseBack = 3, MouseForward = 4;

    private static readonly Dictionary<string, int> ModifierKeys = new()
    {
        ["shift"] = Shift, ["control"] = Control, ["option"] = Alt, ["command"] = Windows,
    };

    private static readonly HashSet<string> Modes = new() { "hold", "toggle", "press" };

    private readonly EventSink _sink;
    private readonly Func<long> _now;
    private readonly Action<bool> _listening;
    private readonly object _gate = new();
    private List<HotkeyBinding> _bindings = new();
    private readonly HashSet<int> _down = new();
    private readonly HashSet<int> _modifiersDown = new();
    private readonly HashSet<string> _held = new();
    private readonly HashSet<int> _mouseDown = new();
    private TypingCounter? _typing;
    private Timer? _typingTimer;

    /// <summary>How often the typed-word count is reported while counting is on.</summary>
    public const int TypingReportMs = 30_000;

    /// <param name="listening">Called with true when the first binding is set and false when none is left, so the OS hook runs only while needed.</param>
    public HotkeyEngine(EventSink sink, Func<long> now, Action<bool>? listening = null)
    {
        _sink = sink;
        _now = now;
        _listening = listening ?? (_ => { });
    }

    /// <summary>Maps the left and right variants of a modifier to one code.</summary>
    public static int Normalize(int vk) => vk switch
    {
        0xA0 or 0xA1 => Shift,
        0xA2 or 0xA3 => Control,
        0xA4 or 0xA5 => Alt,
        0x5C => Windows,
        _ => vk,
    };

    private static bool IsModifier(int vk) => vk is Shift or Control or Alt or Windows;

    public HotkeyConfigureResult Configure(IReadOnlyList<HotkeyBinding> bindings)
    {
        var accepted = new List<HotkeyBinding>();
        var rejected = new List<HotkeyRejection>();
        var ids = new HashSet<string>();
        foreach (var binding in bindings)
        {
            var problem = Check(binding, ids, accepted.Count);
            if (problem is not null) rejected.Add(new HotkeyRejection(binding.Id, problem.Value.Code, problem.Value.Message));
            else accepted.Add(binding);
        }
        bool nowListening;
        lock (_gate)
        {
            _bindings = accepted;
            _held.Clear();
            _mouseDown.Clear();
            nowListening = accepted.Count > 0;
        }
        _listening(nowListening);
        return new HotkeyConfigureResult(accepted.Select(b => b.Id).ToList(), rejected);
    }

    private static (string Code, string Message)? Check(HotkeyBinding binding, HashSet<string> ids, int accepted)
    {
        if (!ids.Add(binding.Id)) return ("DUPLICATE_ID", "Two bindings have the same id.");
        if (accepted >= MaxBindings) return ("TOO_MANY", $"At most {MaxBindings} bindings are kept.");
        if (!Modes.Contains(binding.Mode)) return ("INVALID_MODE", "The mode is not hold, toggle or press.");
        if (binding.Action == "rewrite" && string.IsNullOrEmpty(binding.RewriteId))
            return ("INVALID_BINDING", "A rewrite binding needs a rewriteId.");
        if (binding.TriggerType == "mouse")
        {
            if (binding.KeyCode is not (MouseMiddle or MouseBack or MouseForward))
                return ("UNSUPPORTED_TRIGGER", "Windows reports the middle, back and forward mouse buttons only.");
            if (binding.Exclusive)
                return ("INVALID_BINDING", "A mouse binding cannot be exclusive.");
            return null;
        }
        if (binding.TriggerType != "key")
            return ("UNSUPPORTED_TRIGGER", "The trigger must be a key or a mouse button.");
        if (binding.KeyCode is < 0 or > 127)
            return ("UNSUPPORTED_KEY", "This key code cannot be used.");
        foreach (var modifier in binding.Modifiers)
        {
            if (!ModifierKeys.ContainsKey(modifier))
                return ("UNSUPPORTED_MODIFIER", $"The {modifier} key does not exist on Windows.");
        }
        if (binding.Exclusive && binding.Mode != "hold")
            return ("INVALID_BINDING", "Only a hold binding can be exclusive.");
        return null;
    }

    /// <summary>
    /// <c>typing.watch</c>: turns word counting on or off. Counting sees keys only while a binding
    /// keeps the listener running, as on the Mac. Off clears the count.
    /// </summary>
    public void WatchTyping(bool enabled, int periodMs = TypingReportMs)
    {
        Timer? old;
        lock (_gate)
        {
            old = _typingTimer;
            _typing = enabled ? new TypingCounter() : null;
            _typingTimer = enabled ? new Timer(_ => ReportTyping(periodMs), null, periodMs, periodMs) : null;
        }
        old?.Dispose();
    }

    /// <summary>Sends the count since the last report, if any words were typed.</summary>
    public void ReportTyping(int periodMs)
    {
        int words;
        lock (_gate) words = _typing?.Take() ?? 0;
        if (words > 0) _sink("typing.activity", new JsonObject { ["words"] = words, ["periodMs"] = periodMs });
    }

    public void Stop()
    {
        WatchTyping(false);
        lock (_gate)
        {
            _bindings = new List<HotkeyBinding>();
            _held.Clear();
            _down.Clear();
            _modifiersDown.Clear();
            _mouseDown.Clear();
        }
        _listening(false);
    }

    /// <summary>Feeds one key change from the OS hook.</summary>
    public void OnKey(int rawVk, bool down)
    {
        var vk = Normalize(rawVk);
        var events = new List<(HotkeyBinding Binding, string State)>();
        lock (_gate)
        {
            if (down)
            {
                if (!_down.Add(vk)) return; // key repeat
                if (IsModifier(vk)) _modifiersDown.Add(vk);
                _typing?.KeyDown(vk, _modifiersDown.Contains(Control), _modifiersDown.Contains(Alt), _modifiersDown.Contains(Windows));
                foreach (var binding in _bindings)
                {
                    if (binding.TriggerType == "key" && binding.Exclusive && _held.Contains(binding.Id) && vk != binding.KeyCode
                        && !binding.Modifiers.Any(m => ModifierKeys[m] == vk))
                    {
                        _held.Remove(binding.Id);
                        events.Add((binding, "interrupted"));
                    }
                }
                foreach (var binding in _bindings)
                {
                    if (binding.TriggerType != "key" || binding.KeyCode != vk || !ModifiersMatch(binding, vk)) continue;
                    if (binding.Mode == "hold")
                    {
                        if (_held.Add(binding.Id)) events.Add((binding, "down"));
                    }
                    else
                    {
                        events.Add((binding, "press"));
                    }
                }
            }
            else
            {
                _down.Remove(vk);
                _modifiersDown.Remove(vk);
                foreach (var binding in _bindings)
                {
                    if (binding.TriggerType != "key" || !_held.Contains(binding.Id)) continue;
                    if (binding.KeyCode == vk || binding.Modifiers.Any(m => ModifierKeys[m] == vk))
                    {
                        _held.Remove(binding.Id);
                        events.Add((binding, "up"));
                    }
                }
            }
        }
        foreach (var (binding, state) in events) Emit(binding, state);
    }

    /// <summary>The side button named in the high word of a mouse hook's data (1 is back, 2 is forward), in the protocol's numbering, or 0.</summary>
    public static int XButton(uint mouseData) => (int)(mouseData >> 16) switch
    {
        1 => MouseBack,
        2 => MouseForward,
        _ => 0,
    };

    /// <summary>Feeds one mouse button change (middle, back or forward) from the OS hook.</summary>
    public void OnMouse(int button, bool down)
    {
        var events = new List<(HotkeyBinding Binding, string State)>();
        lock (_gate)
        {
            if (down ? !_mouseDown.Add(button) : !_mouseDown.Remove(button)) return;
            foreach (var binding in _bindings)
            {
                if (binding.TriggerType != "mouse" || binding.KeyCode != button) continue;
                if (binding.Mode == "hold")
                {
                    if (down && _held.Add(binding.Id)) events.Add((binding, "down"));
                    else if (!down && _held.Remove(binding.Id)) events.Add((binding, "up"));
                }
                else if (down)
                {
                    events.Add((binding, "press"));
                }
            }
        }
        foreach (var (binding, state) in events) Emit(binding, state);
    }

    private bool ModifiersMatch(HotkeyBinding binding, int triggerVk)
    {
        var wanted = binding.Modifiers.Select(m => ModifierKeys[m]).ToHashSet();
        var current = _modifiersDown.Where(m => m != triggerVk).ToHashSet();
        return wanted.SetEquals(current);
    }

    private void Emit(HotkeyBinding binding, string state)
    {
        var payload = new JsonObject
        {
            ["bindingId"] = binding.Id,
            ["action"] = binding.Action,
            ["state"] = state,
            ["at"] = _now(),
        };
        if (binding.RewriteId is not null) payload["rewriteId"] = binding.RewriteId;
        _sink("hotkey.event", payload);
    }
}
