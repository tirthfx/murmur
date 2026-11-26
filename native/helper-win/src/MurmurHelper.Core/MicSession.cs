using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>
/// One microphone session at a time (the dictation recording). Audio stays in the helper and is
/// written to a WAV file; the session reports levels while it runs and statistics when it ends.
/// </summary>
public sealed class MicSession
{
    /// <summary>A whole session whose loudest sample is below this counts as silent.</summary>
    public const double SilentPeakDb = -50;
    /// <summary>The first this many milliseconds below the threshold raise audio.silent once.</summary>
    public const int SilentWarningMs = 3000;

    private readonly IAudioSourceFactory _factory;
    private readonly IPermissionProvider _permissions;
    private readonly EventSink _sink;
    private readonly Func<long> _now;
    private readonly string _folder;
    private readonly object _gate = new();
    private readonly object _devices = new();
    private readonly Timer _settle;
    private Active? _active;

    /// <summary>Changes arrive in bursts; they are acted on once they have settled.</summary>
    private const int ChangeSettleMs = 500;

    public MicSession(IAudioSourceFactory factory, IPermissionProvider permissions, EventSink sink, Func<long> now, string folder)
    {
        _factory = factory;
        _permissions = permissions;
        _sink = sink;
        _now = now;
        _folder = folder;
        _settle = new Timer(_ => { try { ApplyDeviceChange(); } catch (Exception) { /* the devices changed again */ } });
        _factory.DevicesChanged += () => _settle.Change(ChangeSettleMs, Timeout.Infinite);
    }

    private sealed class Active
    {
        public required string SessionId;
        public required IAudioSource Source;
        /// <summary>The device the app asked for; null for the system default.</summary>
        public string? Requested;
        public bool Failed;
        public required bool Test;
        public required bool EmitLevels;
        public required int LevelIntervalMs;
        public required double GainDb;
        public WavWriter? Writer;
        public string? Path;
        public long Samples;
        public double SumSquares;
        public double Peak;
        public long LevelSamples;
        public double LevelSum;
        public double LevelPeak;
        public bool SilentRaised;
        public bool HeardSound;
    }

    public JsonObject Devices()
    {
        var devices = new JsonArray();
        foreach (var d in _factory.Devices())
        {
            devices.Add(new JsonObject
            {
                ["id"] = d.Id, ["name"] = d.Name, ["isDefault"] = d.IsDefault,
                ["transport"] = d.Transport, ["sampleRate"] = d.SampleRate,
            });
        }
        return new JsonObject { ["devices"] = devices, ["lidClosed"] = null };
    }

    public JsonObject Start(JsonObject p)
    {
        var sessionId = Payload.Str(p, "sessionId");
        lock (_gate)
        {
            if (_active is not null) throw new HelperException(ErrorCode.Busy, "A microphone session is already running.");
        }
        if (_permissions.Status("microphone") == "denied")
            throw new HelperException(ErrorCode.PermissionDenied, "Microphone access is off for Murmur.");
        var test = Payload.TryBool(p, "test") ?? false;
        var requested = Payload.TryStr(p, "deviceId");
        var source = _factory.Microphone(requested);
        var active = new Active
        {
            SessionId = sessionId,
            Source = source,
            Requested = requested,
            Test = test,
            EmitLevels = Payload.TryBool(p, "emitLevels") ?? false,
            LevelIntervalMs = Payload.TryInt(p, "levelIntervalMs") ?? 100,
            GainDb = (Payload.TryBool(p, "whisper") ?? false) ? 30 : 0,
        };
        if (!test)
        {
            Directory.CreateDirectory(_folder);
            active.Path = Path.Combine(_folder, $"{Safe(sessionId)}.wav");
            active.Writer = new WavWriter(active.Path);
        }
        lock (_gate)
        {
            if (_active is not null)
            {
                source.Dispose();
                active.Writer?.Dispose();
                throw new HelperException(ErrorCode.Busy, "A microphone session is already running.");
            }
            _active = active;
        }
        Attach(active, source);
        try
        {
            source.Start();
        }
        catch (Exception error)
        {
            Discard(active, delete: true);
            lock (_gate) _active = null;
            throw new HelperException(ErrorCode.AudioEngineFailed, error.Message);
        }
        return new JsonObject
        {
            ["startedAt"] = _now(),
            ["sampleRate"] = WavWriter.SampleRate,
            ["channels"] = 1,
            ["deviceName"] = source.DeviceName,
        };
    }

    private void Attach(Active a, IAudioSource source)
    {
        // Samples from a source that was replaced are dropped.
        source.Samples += samples => { if (ReferenceEquals(a.Source, source)) OnSamples(a, samples); };
        source.Failed += _ =>
        {
            if (!ReferenceEquals(a.Source, source)) return;
            a.Failed = true;
            _settle.Change(ChangeSettleMs, Timeout.Infinite);
        };
    }

    /// <summary>
    /// Sends the new device list, and keeps a running session recording (DC-10, DC-16): if its
    /// device is gone, or capture stopped by itself, it continues on the device that was asked for
    /// (if still there) or the system default, into the same file.
    /// </summary>
    public void ApplyDeviceChange()
    {
        lock (_devices)
        {
            var list = Devices()["devices"]!.DeepClone().AsArray();
            _sink("audio.devices.changed", new JsonObject { ["devices"] = list });
            Active? a;
            lock (_gate) a = _active;
            if (a is null) return;
            var present = _factory.Devices().Select(d => d.Id).ToHashSet();
            var removed = a.Source.DeviceId is { } running && !present.Contains(running);
            if (!removed && !a.Failed) return;
            var target = a.Requested is { } wanted && present.Contains(wanted) ? wanted : null;
            var old = a.Source;
            try { old.Stop(); } catch (Exception) { /* already stopped */ }
            old.Dispose();
            string? name = null;
            IAudioSource? next = null;
            try
            {
                next = _factory.Microphone(target);
                lock (_gate)
                {
                    // The session ended while the device was changing.
                    if (_active != a) { next.Dispose(); return; }
                    a.Source = next;
                    a.Failed = false;
                }
                Attach(a, next);
                next.Start();
                name = next.DeviceName;
            }
            catch (Exception)
            {
                next?.Dispose();
            }
            _sink("audio.route.changed", new JsonObject
            {
                ["sessionId"] = a.SessionId,
                ["reason"] = removed ? "device-removed" : "interrupted",
                ["deviceName"] = name,
            });
        }
    }

    private void OnSamples(Active a, float[] raw)
    {
        var gain = (float)Math.Pow(10, a.GainDb / 20);
        var samples = gain == 1f ? raw : raw.Select(s => Math.Clamp(s * gain, -1f, 1f)).ToArray();
        var events = new List<(string, JsonObject)>();
        lock (_gate)
        {
            if (_active != a) return;
            a.Writer?.Write(samples);
            foreach (var s in samples)
            {
                a.SumSquares += (double)s * s;
                a.Peak = Math.Max(a.Peak, Math.Abs(s));
                a.LevelSum += (double)s * s;
                a.LevelPeak = Math.Max(a.LevelPeak, Math.Abs(s));
                a.Samples++;
                a.LevelSamples++;
                var intervalSamples = (long)a.LevelIntervalMs * WavWriter.SampleRate / 1000;
                if (a.LevelSamples >= intervalSamples)
                {
                    if (a.EmitLevels)
                    {
                        events.Add(("audio.level", new JsonObject
                        {
                            ["sessionId"] = a.SessionId, ["source"] = "mic",
                            ["rmsDb"] = Levels.Db(Math.Sqrt(a.LevelSum / a.LevelSamples)),
                            ["peakDb"] = Levels.Db(a.LevelPeak), ["at"] = _now(),
                        }));
                    }
                    a.LevelSamples = 0; a.LevelSum = 0; a.LevelPeak = 0;
                }
            }
            if (Levels.Db(a.Peak) > SilentPeakDb) a.HeardSound = true;
            var elapsedMs = a.Samples * 1000 / WavWriter.SampleRate;
            if (!a.SilentRaised && !a.HeardSound && elapsedMs >= SilentWarningMs)
            {
                a.SilentRaised = true;
                events.Add(("audio.silent", new JsonObject { ["sessionId"] = a.SessionId, ["elapsedMs"] = elapsedMs }));
            }
        }
        foreach (var (type, payload) in events) _sink(type, payload);
    }

    public JsonObject Stop(JsonObject p)
    {
        var a = Take(Payload.Str(p, "sessionId"));
        a.Source.Stop();
        a.Source.Dispose();
        a.Writer?.Dispose();
        var rms = a.Samples == 0 ? Levels.FloorDb : Levels.Db(Math.Sqrt(a.SumSquares / a.Samples));
        var peak = Levels.Db(a.Peak);
        JsonNode? file = null;
        if (a.Path is not null && a.Samples > 0)
        {
            file = new JsonObject { ["path"] = a.Path, ["codec"] = "pcm_s16le", ["bytes"] = new FileInfo(a.Path).Length };
        }
        return new JsonObject
        {
            ["durationMs"] = a.Samples * 1000 / WavWriter.SampleRate,
            ["samples"] = a.Samples,
            ["peakDb"] = peak,
            ["meanDb"] = rms,
            ["silent"] = peak <= SilentPeakDb,
            ["audioFile"] = file,
        };
    }

    public JsonObject Cancel(JsonObject p)
    {
        var id = Payload.Str(p, "sessionId");
        Active? a;
        lock (_gate)
        {
            a = _active is not null && _active.SessionId == id ? _active : null;
            if (a is not null) _active = null;
        }
        if (a is null) return new JsonObject { ["discarded"] = false };
        Discard(a, delete: true);
        return new JsonObject { ["discarded"] = true };
    }

    public void Shutdown()
    {
        Active? a;
        lock (_gate) { a = _active; _active = null; }
        if (a is not null) Discard(a, delete: false);
    }

    private Active Take(string sessionId)
    {
        lock (_gate)
        {
            if (_active is null || _active.SessionId != sessionId)
                throw new HelperException(ErrorCode.NotFound, "There is no such microphone session.");
            var a = _active;
            _active = null;
            return a;
        }
    }

    private static void Discard(Active a, bool delete)
    {
        try { a.Source.Stop(); } catch { /* already stopped */ }
        a.Source.Dispose();
        a.Writer?.Dispose();
        if (delete && a.Path is not null) { try { File.Delete(a.Path); } catch { /* gone */ } }
    }

    private static string Safe(string id) => new(id.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '_').ToArray());
}
