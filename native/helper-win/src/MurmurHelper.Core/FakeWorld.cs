using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>
/// A stand-in for the operating system: a text field, permissions, a front app, windows, a
/// microphone that hears a tone. The helper's own code (router, controllers, hotkey engine) runs
/// on it unchanged, so the protocol can be tested on any machine. Used by the unit tests and by
/// <c>MURMUR_HELPER_FAKE=1</c>, which the app's conformance suite uses; it is never the default.
/// </summary>
public sealed class FakeWorld
{
    public sealed class Permissions : IPermissionProvider
    {
        public readonly Dictionary<string, string> Values = new()
        {
            ["microphone"] = "not_determined", ["accessibility"] = "granted",
            ["inputMonitoring"] = "granted", ["screenRecording"] = "granted",
        };
        public string Status(string kind) => Values.TryGetValue(kind, out var s) ? s : "unknown";
        public bool Request(string kind)
        {
            if (Values.TryGetValue(kind, out var s) && s == "not_determined") Values[kind] = "granted";
            return false;
        }
    }

    public sealed class Source(string name, bool tone = true, string? id = "mic-1") : IAudioSource
    {
        public string DeviceName { get; } = name;
        public string? DeviceId { get; } = id;
        public event Action<float[]>? Samples;
        public event Action<string>? Failed;
        public bool Started { get; private set; }
        public void Start()
        {
            Started = true;
            if (!tone) return;
            var burst = new float[WavWriter.SampleRate];
            for (var i = 0; i < burst.Length; i++) burst[i] = 0.3f * (float)Math.Sin(2 * Math.PI * 440 * i / WavWriter.SampleRate);
            Samples?.Invoke(burst);
        }
        public void Push(float[] samples) => Samples?.Invoke(samples);
        public void Fail(string code) => Failed?.Invoke(code);
        public void Stop() => Started = false;
        public void Dispose() { }
    }

    public sealed class Audio : IAudioSourceFactory
    {
        public bool SystemAvailable = true;
        public readonly List<AudioDeviceInfo> Inputs = new() { new AudioDeviceInfo("mic-1", "Test microphone", true, "builtin", 48000) };
        public Source? Last;
        public event Action? DevicesChanged;
        public void Changed() => DevicesChanged?.Invoke();
        public IReadOnlyList<AudioDeviceInfo> Devices() => Inputs.ToList();
        public IAudioSource Microphone(string? deviceId)
        {
            var device = deviceId is null ? Inputs.FirstOrDefault() : Inputs.FirstOrDefault(d => d.Id == deviceId);
            if (device is null) throw new HelperException(ErrorCode.DeviceNotFound, "No such microphone.");
            return Last = new Source(device.Name, id: device.Id);
        }
        public IAudioSource? SystemOutput() => SystemAvailable ? new Source("Test output") : null;
    }

    public sealed class Inserter(FakeWorld world) : IInsertionPlatform
    {
        public string? Clipboard;
        public string? FrontProcessName() => world.FrontApp?.ProcessName;
        public bool? Paste(string text, string? html, bool restore, int restoreDelayMs)
        {
            world.Field += text;
            return restore ? true : null;
        }
        public void Type(string text) => world.Field += text;
        public void PressEnter() => world.Field += "\n";
        public void Copy(string text) => Clipboard = text;
    }

    /// <summary>The selection in the fake text field, the clipboard, and the keys pressed.</summary>
    public sealed class Desktop(FakeWorld world) : ISelectionPlatform, IKeyboardPlatform, IProcessTable, IInstalledApps, IAppActivator
    {
        /// <summary>Programs that are running and can be brought forward.</summary>
        public readonly HashSet<string> Running = new(StringComparer.OrdinalIgnoreCase) { "notepad.exe", "app.one" };
        public bool Activate(string processName)
        {
            if (!Running.Contains(processName)) return false;
            world.FrontApp = new FrontAppInfo(processName, processName, 100);
            return true;
        }
        public string Selected = "";
        /// <summary>What UI Automation answers; null means the field's own selection.</summary>
        public FocusedSelection? Reads;
        /// <summary>What the app puts on the clipboard when asked to copy; null when it copies nothing.</summary>
        public string? Copies;
        public bool SaveFails, KeysRefused;
        public uint ClipboardSequence { get; set; }
        public string? ClipboardText = "before";
        public int CopyPresses, Restores;
        public readonly List<KeyStroke> Pressed = new();
        public readonly List<ProcessRow> Processes = new() { new(100, 1, "WindowsTerminal.exe"), new(101, 100, "pwsh.exe"), new(102, 101, "node.exe") };
        public readonly Dictionary<int, string> CommandLines = new() { [102] = "node C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js" };

        public string? FrontProcessName() => world.FrontApp?.ProcessName;
        public FocusedSelection Read(int maxLength) =>
            Reads ?? new FocusedSelection(SelectionKind.Selected, Selected, 0, Selected.Length);
        public object? SaveClipboard() => SaveFails ? null : new Saved(ClipboardText);
        public string? ReadClipboardText() => ClipboardText;
        public void RestoreClipboard(object saved)
        {
            Restores++;
            ClipboardText = ((Saved)saved).Text;
            ClipboardSequence++;
        }
        public bool PressCopy()
        {
            CopyPresses++;
            if (Copies is null) return true;
            ClipboardText = Copies;
            ClipboardSequence++;
            return true;
        }
        public bool Press(KeyStroke stroke)
        {
            if (KeysRefused) return false;
            Pressed.Add(stroke);
            return true;
        }
        public int? FrontProcessId() => world.FrontApp?.Pid;
        public IReadOnlyList<ProcessRow> Rows() => Processes;
        public string? CommandLine(int pid) => CommandLines.GetValueOrDefault(pid);
        public IEnumerable<InstalledApp> List() => new[] { new InstalledApp("notepad.exe", "Notepad"), new InstalledApp("chrome.exe", "Google Chrome") };

        private sealed record Saved(string? Text);
    }

    /// <summary>The fake text field as UI Automation would show it: the caret is at the end.</summary>
    public sealed class Reader(FakeWorld world) : IFocusReader, IWatchedFieldSource, IWatchedField, IInspectSource, ISiteReader
    {
        public bool Secure;
        public bool Focused = true;
        public string? Title = "Untitled";
        public string? Address;
        public FrontAppInfo? App() => world.FrontApp;
        public string? WindowTitle() => Title;
        public string? PageAddress() => Address;
        public FocusedField? Field(int maxBefore, int maxAfter) => new("Edit", true, Secure, world.Field);
        IWatchedField? IWatchedFieldSource.Focused() => Secure ? null : this;
        public string? Value() => world.Field;
        public bool IsFocused() => Focused;
        public (FrontAppInfo App, IInspectable Window)? Target() =>
            world.FrontApp is { } app ? (app, new Node("Window", "Test window", new[] { new Node("Edit", null, Array.Empty<Node>(), world.Field, Secure) })) : null;

        public sealed record Node(string Kind, string? Name, IReadOnlyList<Node> Nodes, string? Text = null, bool Password = false) : IInspectable
        {
            public string? Role => Kind;
            public string? Title => Name;
            public bool Editable => Kind == "Edit";
            public bool Secure => Password;
            public (int Location, int Length)? SelectedRange() => Kind == "Edit" ? (Text?.Length ?? 0, 0) : null;
            public string? Value() => Text;
            public IReadOnlyList<IInspectable> Children() => Nodes;
        }
    }

    public sealed class Player : IMediaPlayback
    {
        /// <summary>Null: the system does not say.</summary>
        public bool? Playing = true;
        private bool _paused;
        public bool? IsPlaying() => Playing;
        public bool Pause()
        {
            Playing = false;
            return _paused = true;
        }
        public bool Resume()
        {
            if (!_paused) return false;
            _paused = false;
            Playing = true;
            return true;
        }
    }

    public sealed class Store : ISecureStore
    {
        private readonly Dictionary<string, string> _items = new();
        private static string Key(string service, string account) => $"{service}\u0000{account}";
        public string? Get(string service, string account) => _items.GetValueOrDefault(Key(service, account));
        public void Set(string service, string account, string value) => _items[Key(service, account)] = value;
        public bool Delete(string service, string account) => _items.Remove(Key(service, account));
    }

    public sealed class Mute : IOutputMute
    {
        private bool _muted;
        public bool? Muted => _muted;
        public void SetMuted(bool muted) => _muted = muted;
    }

    private static readonly Dictionary<string, WindowInfo> CallWindows = new()
    {
        ["zoom"] = new WindowInfo("Zoom.exe", "Zoom Meeting"),
        ["meet"] = new WindowInfo("chrome.exe", "Meet - abc-defg-hij"),
        ["teams"] = new WindowInfo("ms-teams.exe", "Meeting with Bea"),
    };

    public readonly Permissions PermissionState = new();
    public readonly Audio AudioState = new();
    public readonly Store SecureStore = new();
    public readonly Mute OutputState = new();
    public readonly Inserter InsertionState;
    public readonly Desktop DesktopState;
    public readonly Reader ReaderState;
    public readonly Player PlayerState = new();
    public readonly List<WindowInfo> Windows = new();
    public string Field = "";
    public FrontAppInfo? FrontApp;

    private readonly HotkeyEngine _hotkeys;
    private readonly FrontAppWatch _front;
    private readonly MeetingDetection _detection;

    public FakeWorld(EventSink sink, Func<long> now)
    {
        InsertionState = new Inserter(this);
        DesktopState = new Desktop(this);
        ReaderState = new Reader(this);
        _hotkeys = new HotkeyEngine(sink, now);
        _front = new FrontAppWatch(() => FrontApp, sink, ReaderState, sitePolls: 1);
        _detection = new MeetingDetection(() => Windows.ToList(), sink);
    }

    /// <summary>A speech engine that needs no model: it answers a fixed sentence and records what it was asked.</summary>
    public FakeSpeechEngine Speech { get; } = new();

    public Backends Backends() => new()
    {
        Permissions = PermissionState,
        Hotkeys = _hotkeys,
        Insertion = InsertionState,
        SecureStore = SecureStore,
        Audio = AudioState,
        FrontApp = _front,
        Detection = _detection,
        Output = OutputState,
        Speech = Speech,
        Selection = DesktopState,
        Keyboard = DesktopState,
        Processes = DesktopState,
        InstalledApps = DesktopState,
        Activator = DesktopState,
        Focus = ReaderState,
        WatchedFields = ReaderState,
        Inspect = ReaderState,
        ReportsSites = true,
        Media = PlayerState,
        TestWorld = Act,
    };

    /// <summary>The fake OS's controls, reached by the <c>test.world</c> request.</summary>
    public JsonObject Act(JsonObject p)
    {
        switch (Payload.Str(p, "op"))
        {
            case "setPermission":
                PermissionState.Values[Payload.Str(p, "kind")] = Payload.Str(p, "status");
                return new JsonObject();
            case "mouse":
                _hotkeys.OnMouse(Payload.Int(p, "button"), Payload.Bool(p, "down"));
                return new JsonObject();
            case "key":
            {
                var down = Payload.Bool(p, "down");
                var mods = Payload.Strings(p, "modifiers").Select(m => m switch
                {
                    "shift" => HotkeyEngine.Shift, "control" => HotkeyEngine.Control,
                    "option" => HotkeyEngine.Alt, _ => HotkeyEngine.Windows,
                }).ToList();
                if (down)
                {
                    foreach (var m in mods) _hotkeys.OnKey(m, true);
                    _hotkeys.OnKey(Payload.Int(p, "keyCode"), true);
                }
                else
                {
                    _hotkeys.OnKey(Payload.Int(p, "keyCode"), false);
                    foreach (var m in Enumerable.Reverse(mods)) _hotkeys.OnKey(m, false);
                }
                return new JsonObject();
            }
            case "selectText":
                DesktopState.Selected = Payload.Str(p, "text");
                return new JsonObject();
            case "typingReport":
                _hotkeys.ReportTyping(HotkeyEngine.TypingReportMs);
                return new JsonObject();
            case "plugDevice":
            {
                var id = Payload.Str(p, "id");
                AudioState.Inputs.RemoveAll(d => d.Id == id);
                if (Payload.Bool(p, "connected")) AudioState.Inputs.Add(new AudioDeviceInfo(id, Payload.Str(p, "name"), false, "usb", 48000));
                AudioState.Changed();
                return new JsonObject();
            }
            case "editField":
                Field = Payload.Str(p, "text");
                return new JsonObject();
            case "focusTextField":
                Field = "";
                DesktopState.Selected = "";
                return new JsonObject();
            case "readField":
                return new JsonObject { ["text"] = Field };
            case "focusApp":
                FrontApp = new FrontAppInfo(Payload.Str(p, "bundleId"), Payload.Str(p, "name"), 100);
                _front.Tick();
                return new JsonObject();
            case "setCall":
            {
                var id = Payload.Str(p, "matcherId");
                if (!CallWindows.TryGetValue(id, out var window)) throw new HelperException(ErrorCode.InvalidPayload, "unknown matcher");
                Windows.RemoveAll(w => w == window);
                if (Payload.Bool(p, "active")) Windows.Add(window);
                _detection.Tick();
                return new JsonObject();
            }
            default:
                throw new HelperException(ErrorCode.InvalidPayload, "unknown test op");
        }
    }
}

/// <summary>Stands in for a speech model on the fake OS and in tests.</summary>
public sealed class FakeSpeechEngine : ISpeechEngine
{
    public const string Sentence = "this is a fake transcript";
    public string ComputeUnits => "fake";
    public string? LoadedFrom { get; private set; }
    public string? LastLanguage { get; private set; }
    public string? LastPrompt { get; private set; }
    public bool LastTranslate { get; private set; }
    public int LastSampleCount { get; private set; }
    public int Calls { get; private set; }
    /// <summary>The language the fake "detects" when it is not told one.</summary>
    public string Detects { get; set; } = "en";
    public string? FailLoadWith { get; set; }
    public Action<CancellationToken>? OnTranscribe { get; set; }

    public void Load(string model, string modelDir)
    {
        if (FailLoadWith is not null) throw new InvalidOperationException(FailLoadWith);
        LoadedFrom = modelDir;
    }

    public void Unload() => LoadedFrom = null;

    public SpeechResult Transcribe(float[] samples, string? language, string? prompt, bool translate, CancellationToken cancel)
    {
        Calls++;
        LastLanguage = language;
        LastPrompt = prompt;
        LastTranslate = translate;
        LastSampleCount = samples.Length;
        OnTranscribe?.Invoke(cancel);
        cancel.ThrowIfCancellationRequested();
        var ms = (int)(samples.Length * 1000L / WavWriter.SampleRate);
        return new SpeechResult(" " + Sentence + " ", language ?? Detects,
            new[] { new SpeechSegment(0, ms, Sentence, 0.9) });
    }
}
