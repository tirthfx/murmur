using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>
/// Turns inbound envelopes into outbound ones and owns the handshake state. It does no I/O of its
/// own: lines go in, envelopes come out, and events from the backends go to the sink.
/// </summary>
public sealed class Router
{
    public static readonly string[] PermissionKinds = { "microphone", "accessibility", "inputMonitoring", "screenRecording" };

    private readonly Backends _backends;
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly MicSession? _mic;
    private readonly MeetingCapture? _meeting;
    private readonly InsertionController? _insertion;
    private readonly SpeechController? _speech;
    private bool _handshake;

    public Router(Backends backends, MicSession? mic, MeetingCapture? meeting)
    {
        _backends = backends;
        _mic = mic;
        _meeting = meeting;
        _insertion = backends.Insertion is null ? null : new InsertionController(backends.Insertion);
        _speech = backends.Speech is null ? null : new SpeechController(backends.Speech);
    }

    public bool ShouldExit { get; private set; }

    /// <summary>What this build does, so the app checks before it relies on a feature.</summary>
    public IReadOnlyList<string> Capabilities()
    {
        var list = new List<string> { "permissions.check" };
        if (_backends.Hotkeys is not null) list.Add("hotkey.hold");
        if (_mic is not null) { list.Add("audio.capture"); list.Add("audio.silent-warning"); }
        if (_insertion is not null) { list.Add("insert.paste"); list.Add("insert.keystrokes"); list.Add("insert.press-enter"); }
        if (_backends.Output is not null) list.Add("media.mute");
        if (_backends.FrontApp is not null) list.Add("focus.watch");
        if (_meeting is not null) list.Add("meeting.capture");
        if (_backends.Detection is not null) list.Add("detect.watch");
        if (_backends.SecureStore is not null) list.Add("keychain");
        if (_speech is not null) { list.Add("transcribe.file"); list.Add("transcribe.prompt"); list.Add("transcribe.translate"); }
        return list;
    }

    public Envelope HelloEvent() => new(null, "hello", new JsonObject
    {
        ["protocolVersion"] = ProtocolConstants.ProtocolVersion,
        ["helperVersion"] = ProtocolConstants.HelperVersion,
        ["capabilities"] = new JsonArray(Capabilities().Select(c => (JsonNode?)JsonValue.Create(c)).ToArray()),
        ["windows"] = new JsonObject { ["os"] = System.Runtime.InteropServices.RuntimeInformation.OSDescription },
        ["pid"] = Environment.ProcessId,
    });

    public static Envelope OversizedLineError() =>
        HelperError(ErrorCode.InvalidPayload, $"Line exceeds {ProtocolConstants.MaxLineBytes} bytes and was dropped");

    /// <summary>Requests that can take long. With a <c>later</c> callback they run on their own task, so pings keep being answered.</summary>
    private static bool IsSlow(string type) => type is "transcribe.load" or "transcribe.file";

    /// <summary>
    /// Handles one line from stdin. Never throws on bad input. A slow request (speech) answers
    /// through <paramref name="later"/> when one is given; without it the answer is returned.
    /// </summary>
    public IReadOnlyList<Envelope> Handle(string line, Action<Envelope>? later = null)
    {
        switch (EnvelopeCodec.Decode(line))
        {
            case Decoded.Malformed:
                return new[] { HelperError(ErrorCode.InvalidPayload, "Line is not valid JSON") };
            case Decoded.Invalid invalid:
                return new[] { invalid.Id is null
                    ? HelperError(ErrorCode.InvalidPayload, invalid.Reason)
                    : Failure(invalid.Id, invalid.Type ?? "", ErrorCode.InvalidPayload, invalid.Reason) };
            case Decoded.Ok ok:
                if (later is not null && _handshake && ok.Envelope.Id is not null && IsSlow(ok.Envelope.Type))
                {
                    var request = ok.Envelope;
                    Task.Run(() => later(Route(request)));
                    return Array.Empty<Envelope>();
                }
                return new[] { Route(ok.Envelope) };
            default:
                return Array.Empty<Envelope>();
        }
    }

    private Envelope Route(Envelope envelope)
    {
        if (envelope.Id is null) return HelperError(ErrorCode.InvalidPayload, "Requests must carry an id");
        var id = envelope.Id;
        var type = envelope.Type;
        try
        {
            if (type == "hello.ack") return Success(id, type, Ack(envelope.Payload));
            if (!_handshake) return Failure(id, type, ErrorCode.HandshakeRequired, "Send hello.ack before any other request");
            return Success(id, type, Dispatch(type, envelope.Payload));
        }
        catch (HelperException error)
        {
            return Failure(id, type, error.Code, error.Message);
        }
        catch (Exception error)
        {
            return Failure(id, type, ErrorCode.Internal, error.Message);
        }
    }

    private JsonObject Ack(JsonObject p)
    {
        var accepted = Payload.TryBool(p, "accepted");
        var version = Payload.TryInt(p, "protocolVersion");
        if (accepted is null || version is null || Payload.TryStr(p, "appVersion") is null)
            throw new HelperException(ErrorCode.InvalidPayload, "hello.ack needs accepted (bool), protocolVersion (int) and appVersion (string)");
        if (version != ProtocolConstants.ProtocolVersion)
            throw new HelperException(ErrorCode.ProtocolVersionMismatch, $"Helper speaks protocol {ProtocolConstants.ProtocolVersion}, main sent {version}");
        _handshake = accepted.Value;
        return new JsonObject { ["ready"] = accepted.Value };
    }

    private JsonObject Dispatch(string type, JsonObject p)
    {
        switch (type)
        {
            case "ping":
                return new JsonObject { ["uptimeMs"] = _clock.ElapsedMilliseconds };
            case "shutdown":
                Shutdown();
                return new JsonObject();
            case "permissions.status":
            {
                var result = new JsonObject();
                foreach (var kind in PermissionKinds) result[kind] = _backends.Permissions.Status(kind);
                return result;
            }
            case "permissions.request":
            {
                var kind = Payload.Str(p, "kind");
                if (kind is not ("microphone" or "accessibility" or "inputMonitoring"))
                    throw new HelperException(ErrorCode.InvalidPayload, "That permission cannot be requested.");
                var opened = _backends.Permissions.Request(kind);
                return new JsonObject { ["status"] = _backends.Permissions.Status(kind), ["openedSettings"] = opened };
            }
            case "hotkey.configure":
            {
                var hotkeys = Need(_backends.Hotkeys);
                var list = (p["bindings"] as JsonArray ?? throw new HelperException(ErrorCode.InvalidPayload, "bindings must be a list"))
                    .Select(item => HotkeyBinding.Parse(item as JsonObject ?? throw new HelperException(ErrorCode.InvalidPayload, "a binding must be an object")))
                    .ToList();
                var result = hotkeys.Configure(list);
                return new JsonObject
                {
                    ["registered"] = new JsonArray(result.Registered.Select(id => (JsonNode?)JsonValue.Create(id)).ToArray()),
                    ["rejected"] = new JsonArray(result.Rejected.Select(r => (JsonNode?)new JsonObject
                    {
                        ["id"] = r.Id, ["code"] = r.Code, ["message"] = r.Message,
                    }).ToArray()),
                };
            }
            case "audio.devices": return Need(_mic).Devices();
            case "audio.start": return Need(_mic).Start(p);
            case "audio.stop": return Need(_mic).Stop(p);
            case "audio.cancel": return Need(_mic).Cancel(p);
            case "insert.text": return Need(_insertion).Insert(InsertionController.Parse(p));
            case "insert.copy":
                Need(_backends.Insertion).Copy(Payload.Str(p, "text"));
                return new JsonObject();
            case "media.status":
            {
                var muted = Need(_backends.Output).Muted;
                return new JsonObject { ["playing"] = "unknown", ["outputMuted"] = muted };
            }
            case "media.mute":
            {
                var output = Need(_backends.Output);
                var wanted = Payload.Bool(p, "muted");
                var previous = output.Muted ?? false;
                output.SetMuted(wanted);
                return new JsonObject { ["previousMuted"] = previous };
            }
            case "focus.watch":
            {
                var enabled = Payload.Bool(p, "enabled");
                Need(_backends.FrontApp).Watch(enabled);
                return new JsonObject { ["watching"] = enabled };
            }
            case "detect.subscribe":
            {
                var enabled = Payload.Bool(p, "enabled");
                Need(_backends.Detection).Subscribe(enabled, MeetingMatcher.ParseAll(p["matchers"] as JsonArray));
                return new JsonObject { ["watching"] = enabled };
            }
            case "transcribe.load": return Need(_speech).Load(p);
            case "transcribe.unload":
                Need(_speech).Unload();
                return new JsonObject();
            case "transcribe.file": return Need(_speech).File(p);
            case "capture.start": return Need(_meeting).Start(p);
            case "capture.stop": return Need(_meeting).Stop(p);
            case "keychain.get":
            {
                var value = Store().Get(Payload.Str(p, "service"), Payload.Str(p, "account"));
                return new JsonObject { ["found"] = value is not null, ["value"] = value ?? "" };
            }
            case "keychain.set":
                Store().Set(Payload.Str(p, "service"), Payload.Str(p, "account"), Payload.Str(p, "value"));
                return new JsonObject { ["ok"] = true };
            case "keychain.delete":
                return new JsonObject { ["deleted"] = Store().Delete(Payload.Str(p, "service"), Payload.Str(p, "account")) };
            case "test.world" when _backends.TestWorld is not null:
                return _backends.TestWorld(p);
            default:
                throw new HelperException(ErrorCode.UnsupportedRequest, "Unknown request type");
        }
    }

    private ISecureStore Store() => Need(_backends.SecureStore);

    private static T Need<T>(T? backend) where T : class =>
        backend ?? throw new HelperException(ErrorCode.UnsupportedRequest, "Unknown request type");

    /// <summary>Stops everything that is running. Called on shutdown and when the host ends.</summary>
    public void Shutdown()
    {
        _backends.Hotkeys?.Stop();
        _mic?.Shutdown();
        _meeting?.Shutdown();
        _speech?.Shutdown();
        _backends.FrontApp?.Watch(false);
        _backends.Detection?.Subscribe(false, Array.Empty<MeetingMatcher>());
        _backends.OnShutdown?.Invoke();
        ShouldExit = true;
    }

    public static Envelope Success(string id, string requestType, JsonObject result) => new(id, "response", new JsonObject
    {
        ["requestType"] = requestType, ["ok"] = true, ["result"] = result,
    });

    public static Envelope Failure(string id, string requestType, string code, string message) => new(id, "response", new JsonObject
    {
        ["requestType"] = requestType,
        ["ok"] = false,
        ["error"] = new JsonObject { ["code"] = code, ["message"] = message, ["retryable"] = ErrorCode.Retryable(code) },
    });

    public static Envelope HelperError(string code, string message, bool fatal = false) => new(null, "helper.error", new JsonObject
    {
        ["code"] = code, ["message"] = message, ["fatal"] = fatal,
    });
}
