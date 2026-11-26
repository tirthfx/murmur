using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>The app in front: its program file name (its id on Windows), the app's name, and its process id.</summary>
public sealed record FrontAppInfo(string? ProcessName, string? Name, int? Pid);

/// <summary>The host and path of a page. The scheme, query and fragment are dropped here, so they never leave the helper.</summary>
public sealed record SiteInfo(string Host, string Path)
{
    /// <summary>For an http or https address; null for anything else.</summary>
    public static SiteInfo? From(string address)
    {
        var text = address.Trim();
        if (!Uri.TryCreate(text, UriKind.Absolute, out var url) || url.Scheme is not ("http" or "https") || url.Host.Length == 0)
            return null;
        var path = Uri.UnescapeDataString(url.AbsolutePath);
        return new SiteInfo(ContextWindow.After(url.Host.ToLowerInvariant(), 253), ContextWindow.After(path.Length == 0 ? "/" : path, 512));
    }
}

/// <summary>Where a browser's page address comes from.</summary>
public interface ISiteReader
{
    /// <summary>The front window's title: a change means another tab or window, so the page is read again at once.</summary>
    string? WindowTitle();

    /// <summary>The address of the page in the front window, or null when it cannot be read.</summary>
    string? PageAddress();
}

/// <summary>
/// Reports the app in front while on: once at once, then on each change. In a known browser the
/// page's host and path come with it (RW-20), read when the window title changes and about every
/// two seconds.
/// </summary>
public sealed class FrontAppWatch : IFrontAppWatch
{
    /// <summary>Browsers whose page address Murmur tries to read.</summary>
    public static readonly IReadOnlySet<string> Browsers = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe", "vivaldi.exe", "opera.exe", "arc.exe", "chromium.exe",
    };

    private sealed record Page(string Status, SiteInfo? Site = null);
    private static readonly Page NotBrowser = new("none");

    private readonly Func<FrontAppInfo?> _read;
    private readonly EventSink _sink;
    private readonly ISiteReader? _sites;
    private readonly int _sitePolls;
    private readonly object _gate = new();
    private bool _enabled;
    private bool _sent;
    private FrontAppInfo? _last;
    private Page _page = NotBrowser;
    private string? _title;
    private int _polls;

    /// <summary><paramref name="sitePolls"/>: read the page every this many ticks (8 of 250 ms).</summary>
    public FrontAppWatch(Func<FrontAppInfo?> read, EventSink sink, ISiteReader? sites = null, int sitePolls = 8)
    {
        _read = read;
        _sink = sink;
        _sites = sites;
        _sitePolls = sitePolls;
    }

    public bool Enabled { get { lock (_gate) return _enabled; } }

    public void Watch(bool enabled)
    {
        lock (_gate)
        {
            _enabled = enabled;
            _sent = false;
            _last = null;
            _page = NotBrowser;
        }
        if (enabled) Tick();
    }

    /// <summary>Looks at the app in front now; the host calls this on a timer.</summary>
    public void Tick()
    {
        JsonObject? message = null;
        lock (_gate)
        {
            if (!_enabled) return;
            var now = _read();
            var appChanged = !_sent || !Same(_last, now);
            var page = _page;
            if (_sites is null || now?.ProcessName is not { } process || !Browsers.Contains(process))
            {
                page = NotBrowser;
            }
            else
            {
                var title = _sites.WindowTitle();
                if (appChanged || title != _title || ++_polls >= _sitePolls)
                {
                    var address = _sites.PageAddress();
                    page = address is null ? new Page("unavailable") : new Page("ok", SiteInfo.From(address));
                    _title = title;
                    _polls = 0;
                }
            }
            if (appChanged || page != _page)
            {
                message = new JsonObject
                {
                    ["bundleId"] = now?.ProcessName,
                    ["name"] = now?.Name is { Length: > 0 } name ? ContextWindow.After(name, 200) : null,
                    ["pid"] = now?.Pid,
                    ["siteStatus"] = page.Status,
                    ["site"] = page.Site is { } site ? new JsonObject { ["host"] = site.Host, ["path"] = site.Path } : null,
                };
            }
            _last = now;
            _page = page;
            _sent = true;
        }
        if (message is not null) _sink("focus.app", message);
    }

    private static bool Same(FrontAppInfo? a, FrontAppInfo? b) =>
        a?.ProcessName == b?.ProcessName && a?.Pid == b?.Pid;
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
