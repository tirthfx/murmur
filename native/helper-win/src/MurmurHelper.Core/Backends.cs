using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>Where a backend sends an event (hotkey, front app, call, chunk, level).</summary>
public delegate void EventSink(string type, JsonObject payload);

/// <summary>What the OS says about a permission. Windows has no prompts, so most are granted.</summary>
public interface IPermissionProvider
{
    /// <summary>One of granted, denied, not_determined, unknown.</summary>
    string Status(string kind);

    /// <summary>Asks for a permission where the OS allows it; true when a settings page was opened.</summary>
    bool Request(string kind);
}

public interface IHotkeyService
{
    HotkeyConfigureResult Configure(IReadOnlyList<HotkeyBinding> bindings);
    void WatchTyping(bool enabled, int periodMs = HotkeyEngine.TypingReportMs);
    void Stop();
}

public sealed record InsertRequest(
    string Text,
    string Method,
    bool RestoreClipboard,
    int RestoreDelayMs,
    bool PressEnter,
    IReadOnlyList<string> TypeInApps,
    IReadOnlyList<string> TrimTrailingNewlinesInApps,
    string? Html);

/// <summary>The OS calls that put text into the focused field. The rules for using them are in <see cref="InsertionController"/>.</summary>
public interface IInsertionPlatform
{
    /// <summary>The process image name of the app in front (any case), or null.</summary>
    string? FrontProcessName();

    /// <summary>Puts the text on the clipboard, pastes it, and puts the old clipboard back after the delay when asked. True when it was restored, false when it could not be, null when not asked.</summary>
    bool? Paste(string text, string? html, bool restore, int restoreDelayMs);

    void Type(string text);
    void PressEnter();
    void Copy(string text);
}

public interface ISecureStore
{
    string? Get(string service, string account);
    void Set(string service, string account, string value);
    bool Delete(string service, string account);
}

public sealed record AudioDeviceInfo(string Id, string Name, bool IsDefault, string Transport, int SampleRate);

/// <summary>A stream of 16 kHz mono samples from one device.</summary>
public interface IAudioSource : IDisposable
{
    string DeviceName { get; }

    /// <summary>The id of the device being captured, as <see cref="IAudioSourceFactory.Devices"/> lists it.</summary>
    string? DeviceId { get; }
    /// <summary>Raised on the capture thread with samples in the range -1 to 1.</summary>
    event Action<float[]> Samples;
    event Action<string> Failed;
    void Start();
    void Stop();
}

public interface IAudioSourceFactory
{
    IReadOnlyList<AudioDeviceInfo> Devices();

    /// <summary>An input was added, removed or changed.</summary>
    event Action? DevicesChanged;
    /// <summary>The microphone, or the device with this id. Throws <see cref="HelperException"/> DEVICE_NOT_FOUND.</summary>
    IAudioSource Microphone(string? deviceId);
    /// <summary>What the default output is playing (loopback). Null when it cannot be captured.</summary>
    IAudioSource? SystemOutput();
}

public interface IFrontAppWatch
{
    void Watch(bool enabled);
}

public interface IMeetingDetection
{
    void Subscribe(bool enabled, IReadOnlyList<MeetingMatcher> matchers);
}

public interface IOutputMute
{
    /// <summary>Null when the output has no mute switch.</summary>
    bool? Muted { get; }
    void SetMuted(bool muted);
}

/// <summary>Everything the router can call. A null member means the helper does not do that, and the request is refused as unsupported.</summary>
public sealed class Backends
{
    public required IPermissionProvider Permissions { get; init; }
    public IHotkeyService? Hotkeys { get; init; }
    public IInsertionPlatform? Insertion { get; init; }
    public ISecureStore? SecureStore { get; init; }
    public IAudioSourceFactory? Audio { get; init; }
    public IFrontAppWatch? FrontApp { get; init; }
    public IMeetingDetection? Detection { get; init; }
    public IOutputMute? Output { get; init; }
    public ISpeechEngine? Speech { get; init; }
    public ISelectionPlatform? Selection { get; init; }
    public IKeyboardPlatform? Keyboard { get; init; }
    public IProcessTable? Processes { get; init; }
    public IInstalledApps? InstalledApps { get; init; }
    public IFocusReader? Focus { get; init; }
    public IWatchedFieldSource? WatchedFields { get; init; }
    public IInspectSource? Inspect { get; init; }
    public IMediaPlayback? Media { get; init; }
    /// <summary>Whether the front app watch also reports a browser's page.</summary>
    public bool ReportsSites { get; init; }
    /// <summary>Test builds only: handles <c>test.world</c> requests that act on the fake OS.</summary>
    public Func<JsonObject, JsonObject>? TestWorld { get; init; }
    public Action? OnShutdown { get; init; }
}
