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

    public sealed class Source(string name, bool tone = true) : IAudioSource
    {
        public string DeviceName { get; } = name;
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
        public IReadOnlyList<AudioDeviceInfo> Devices() => new[] { new AudioDeviceInfo("mic-1", "Test microphone", true, "builtin", 48000) };
        public IAudioSource Microphone(string? deviceId)
        {
            if (deviceId is not null && deviceId != "mic-1") throw new HelperException(ErrorCode.DeviceNotFound, "No such microphone.");
            return new Source("Test microphone");
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
    public readonly List<WindowInfo> Windows = new();
    public string Field = "";
    public FrontAppInfo? FrontApp;

    private readonly HotkeyEngine _hotkeys;
    private readonly FrontAppWatch _front;
    private readonly MeetingDetection _detection;

    public FakeWorld(EventSink sink, Func<long> now)
    {
        InsertionState = new Inserter(this);
        _hotkeys = new HotkeyEngine(sink, now);
        _front = new FrontAppWatch(() => FrontApp, sink);
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
            case "focusTextField":
                Field = "";
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
