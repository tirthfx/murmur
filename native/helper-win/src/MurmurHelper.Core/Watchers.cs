using System.Text.Json.Nodes;

namespace Murmur.Helper;

public sealed record FrontAppInfo(string? ProcessName, string? Title, int? Pid);

/// <summary>Reports the app in front while on: once at once, then on each change.</summary>
public sealed class FrontAppWatch : IFrontAppWatch
{
    private readonly Func<FrontAppInfo?> _read;
    private readonly EventSink _sink;
    private readonly object _gate = new();
    private bool _enabled;
    private FrontAppInfo? _last;

    public FrontAppWatch(Func<FrontAppInfo?> read, EventSink sink)
    {
        _read = read;
        _sink = sink;
    }

    public bool Enabled { get { lock (_gate) return _enabled; } }

    public void Watch(bool enabled)
    {
        lock (_gate)
        {
            _enabled = enabled;
            _last = null;
        }
        if (enabled) Tick();
    }

    /// <summary>Looks at the app in front now; the host calls this on a timer.</summary>
    public void Tick()
    {
        FrontAppInfo? now;
        lock (_gate)
        {
            if (!_enabled) return;
            now = _read();
            if (_last is not null && Same(_last, now)) return;
            _last = now;
        }
        _sink("focus.app", new JsonObject
        {
            ["bundleId"] = now?.ProcessName,
            ["name"] = now?.Title is { Length: > 0 } title ? title[..Math.Min(title.Length, 200)] : null,
            ["pid"] = now?.Pid,
            ["siteStatus"] = "none",
        });
    }

    private static bool Same(FrontAppInfo a, FrontAppInfo? b) =>
        b is not null && a.ProcessName == b.ProcessName && a.Pid == b.Pid;
}

/// <summary>A call app's windows: process image names and words in a window title.</summary>
public sealed record MeetingMatcher(string Id, IReadOnlyList<string> Processes, IReadOnlyList<string> Titles)
{
    /// <summary>The matchers that have a windows part; the rest are for the Mac helper.</summary>
    public static IReadOnlyList<MeetingMatcher> ParseAll(JsonArray? array)
    {
        var list = new List<MeetingMatcher>();
        foreach (var item in array ?? new JsonArray())
        {
            if (item is not JsonObject matcher || matcher["windows"] is not JsonObject windows) continue;
            list.Add(new MeetingMatcher(Payload.Str(matcher, "id"), Payload.Strings(windows, "processes"), Payload.Strings(windows, "titles")));
        }
        return list;
    }
}

public sealed record WindowInfo(string ProcessName, string Title);

public static class MatcherEvaluator
{
    /// <summary>The ids of the matchers that have a window right now. A title is never kept or sent.</summary>
    public static HashSet<string> Active(IReadOnlyList<MeetingMatcher> matchers, IEnumerable<WindowInfo> windows)
    {
        var active = new HashSet<string>();
        var list = windows.ToList();
        foreach (var matcher in matchers)
        {
            if (list.Any(w =>
                matcher.Processes.Any(p => string.Equals(p, w.ProcessName, StringComparison.OrdinalIgnoreCase))
                && matcher.Titles.Any(t => w.Title.Contains(t, StringComparison.OrdinalIgnoreCase))))
            {
                active.Add(matcher.Id);
            }
        }
        return active;
    }
}

/// <summary>Looks for calls by window title and process name, and says when one starts or ends.</summary>
public sealed class MeetingDetection : IMeetingDetection
{
    private readonly Func<IEnumerable<WindowInfo>> _windows;
    private readonly EventSink _sink;
    private readonly object _gate = new();
    private IReadOnlyList<MeetingMatcher> _matchers = Array.Empty<MeetingMatcher>();
    private bool _enabled;
    private HashSet<string> _active = new();

    public MeetingDetection(Func<IEnumerable<WindowInfo>> windows, EventSink sink)
    {
        _windows = windows;
        _sink = sink;
    }

    public bool Enabled { get { lock (_gate) return _enabled; } }

    public void Subscribe(bool enabled, IReadOnlyList<MeetingMatcher> matchers)
    {
        lock (_gate)
        {
            _enabled = enabled;
            _matchers = enabled ? matchers : Array.Empty<MeetingMatcher>();
            if (!enabled) _active = new HashSet<string>();
        }
        if (enabled) Tick();
    }

    public void Tick()
    {
        var events = new List<JsonObject>();
        lock (_gate)
        {
            if (!_enabled) return;
            var now = MatcherEvaluator.Active(_matchers, _windows());
            foreach (var id in now.Except(_active)) events.Add(Event(id, true));
            foreach (var id in _active.Except(now)) events.Add(Event(id, false));
            _active = now;
        }
        foreach (var e in events) _sink("detect.event", e);
    }

    private static JsonObject Event(string id, bool active) => new() { ["matcherId"] = id, ["active"] = active };
}
