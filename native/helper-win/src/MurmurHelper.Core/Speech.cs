using System.Buffers.Binary;
using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Murmur.Helper;

public sealed record SpeechSegment(int StartMs, int EndMs, string Text, double Confidence);

/// <summary>What an engine heard. <paramref name="Language"/> is the code it used or detected, lower case.</summary>
public sealed record SpeechResult(string Text, string Language, IReadOnlyList<SpeechSegment> Segments);

/// <summary>The speech model behind <c>transcribe.*</c>. One implementation per runtime; the rules for using it are in <see cref="SpeechController"/>.</summary>
public interface ISpeechEngine
{
    /// <summary>What the model runs on, reported to the app after a load ("cpu").</summary>
    string ComputeUnits { get; }

    /// <summary>Loads the model from a folder the app already checked. Throws when it cannot.</summary>
    void Load(string model, string modelDir);

    void Unload();

    /// <summary>16 kHz mono samples in, text out. <paramref name="language"/> null means detect it.</summary>
    SpeechResult Transcribe(float[] samples, string? language, string? prompt, bool translate, CancellationToken cancel);
}

/// <summary>Reads a WAV file as 16 kHz mono samples in the range -1 to 1.</summary>
public static class WavReader
{
    public static float[] ReadMono16k(string path)
    {
        byte[] bytes;
        try { bytes = File.ReadAllBytes(path); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new HelperException(ErrorCode.NotFound, $"The audio file cannot be read: {error.Message}");
        }
        return Decode(bytes);
    }

    public static float[] Decode(byte[] bytes)
    {
        if (bytes.Length < 12 || !bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) || !bytes.AsSpan(8, 4).SequenceEqual("WAVE"u8))
            throw new HelperException(ErrorCode.InvalidPayload, "Only WAV audio files can be transcribed on Windows.");
        int format = 0, channels = 0, rate = 0, bits = 0;
        var dataStart = -1;
        var dataLength = 0;
        var offset = 12;
        while (offset + 8 <= bytes.Length)
        {
            var id = bytes.AsSpan(offset, 4);
            var size = BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(offset + 4));
            var body = offset + 8;
            if (size < 0) break;
            if (id.SequenceEqual("fmt "u8) && body + 16 <= bytes.Length)
            {
                format = BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(body));
                channels = BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(body + 2));
                rate = BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(body + 4));
                bits = BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(body + 14));
                // WAVE_FORMAT_EXTENSIBLE keeps the real format in the sub-format field.
                if (format == unchecked((short)0xFFFE) && size >= 26 && body + 26 <= bytes.Length)
                    format = BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(body + 24));
            }
            else if (id.SequenceEqual("data"u8))
            {
                dataStart = body;
                // A writer that stopped early leaves a length past the end; take what is there.
                dataLength = Math.Min(size, bytes.Length - body);
                break;
            }
            offset = body + size + (size & 1);
        }
        if (dataStart < 0 || channels <= 0 || rate <= 0)
            throw new HelperException(ErrorCode.InvalidPayload, "The WAV file has no audio data.");

        float[] interleaved;
        if (format == 1 && bits == 16)
        {
            interleaved = new float[dataLength / 2];
            for (var i = 0; i < interleaved.Length; i++)
                interleaved[i] = BinaryPrimitives.ReadInt16LittleEndian(bytes.AsSpan(dataStart + i * 2)) / 32768f;
        }
        else if (format == 3 && bits == 32)
        {
            interleaved = new float[dataLength / 4];
            for (var i = 0; i < interleaved.Length; i++)
                interleaved[i] = BinaryPrimitives.ReadSingleLittleEndian(bytes.AsSpan(dataStart + i * 4));
        }
        else
        {
            throw new HelperException(ErrorCode.InvalidPayload, $"WAV format {format} with {bits} bits is not supported.");
        }
        return new Resampler(rate, channels).Process(interleaved);
    }
}

/// <summary>
/// The rules around a speech engine: one load or transcription at a time, trimming silence,
/// choosing among several languages, and a time limit. Engines only turn samples into text.
/// </summary>
public sealed class SpeechController
{
    /// <summary>Seconds of decoding allowed for each started 30 seconds of audio.</summary>
    public const int DecodeSecondsPer30 = 20;
    private const double SilenceDb = -50;
    private const int WindowSamples = 320; // 20 ms
    private const int PadSamples = 2400; // 150 ms kept around the speech

    private readonly ISpeechEngine _engine;
    private readonly object _gate = new();
    private bool _busy;
    private bool _loaded;

    public SpeechController(ISpeechEngine engine) => _engine = engine;

    public JsonObject Load(JsonObject p)
    {
        var model = Payload.Str(p, "model");
        var modelDir = Payload.Str(p, "modelDir");
        Payload.Str(p, "tokenizerDir"); // the protocol carries it for the Mac model; whisper.cpp has none
        Enter();
        try
        {
            var clock = Stopwatch.StartNew();
            _loaded = false;
            try { _engine.Load(model, modelDir); }
            catch (HelperException) { throw; }
            catch (Exception error) { throw new HelperException("MODEL_LOAD_FAILED", error.Message); }
            _loaded = true;
            return new JsonObject
            {
                ["loadedModel"] = model,
                ["loadMs"] = (int)clock.ElapsedMilliseconds,
                ["computeUnits"] = _engine.ComputeUnits,
            };
        }
        finally { Leave(); }
    }

    public void Unload()
    {
        Enter();
        try
        {
            _engine.Unload();
            _loaded = false;
        }
        finally { Leave(); }
    }

    public JsonObject File(JsonObject p)
    {
        var path = Payload.Str(p, "path");
        var languages = Payload.Strings(p, "languages").Select(Primary).Where(code => code.Length > 0).Distinct().ToList();
        var prompt = Payload.TryStr(p, "prompt");
        var keepTiming = Payload.TryBool(p, "keepTiming") ?? false;
        var translate = Payload.TryBool(p, "translate") ?? false;
        Enter();
        try
        {
            if (!_loaded) throw new HelperException("MODEL_NOT_LOADED", "No speech model is loaded.");
            var samples = WavReader.ReadMono16k(path);
            var audioMs = (int)(samples.Length * 1000L / WavWriter.SampleRate);
            var clock = Stopwatch.StartNew();
            var heard = Trim(samples, keepTiming, out var offsetMs);
            if (heard.Length == 0)
                return Result("", languages.FirstOrDefault() ?? "", Array.Empty<SpeechSegment>(), 0, audioMs);

            var budget = TimeSpan.FromSeconds(DecodeSecondsPer30 * Math.Ceiling(Math.Max(1, audioMs / 30000.0)));
            using var timeout = new CancellationTokenSource(budget);
            SpeechResult result;
            try
            {
                result = _engine.Transcribe(heard, languages.Count == 1 ? languages[0] : null, prompt, translate, timeout.Token);
                // Several languages: the model detected one; keep it only if it is one the person chose.
                if (languages.Count > 1 && !languages.Contains(result.Language))
                    result = _engine.Transcribe(heard, languages[0], prompt, translate, timeout.Token);
            }
            catch (OperationCanceledException)
            {
                throw new HelperException("TRANSCRIPTION_TIMEOUT", "Transcription took longer than allowed.");
            }
            catch (HelperException) { throw; }
            catch (Exception error) { throw new HelperException("TRANSCRIPTION_FAILED", error.Message); }

            var segments = result.Segments
                .Select(s => s with { StartMs = s.StartMs + offsetMs, EndMs = s.EndMs + offsetMs })
                .ToList();
            return Result(result.Text.Trim(), result.Language, segments, (int)clock.ElapsedMilliseconds, audioMs);
        }
        finally { Leave(); }
    }

    public void Shutdown()
    {
        lock (_gate)
        {
            try { _engine.Unload(); } catch { /* going away */ }
            _loaded = false;
        }
    }

    /// <summary>Cuts silence off both ends unless the timing must match the file. Empty when nothing is above the floor.</summary>
    public static float[] Trim(float[] samples, bool keepTiming, out int offsetMs)
    {
        offsetMs = 0;
        var first = -1;
        var last = -1;
        for (var start = 0; start < samples.Length; start += WindowSamples)
        {
            var length = Math.Min(WindowSamples, samples.Length - start);
            if (Levels.Measure(samples.AsSpan(start, length)).RmsDb <= SilenceDb) continue;
            if (first < 0) first = start;
            last = start + length;
        }
        if (first < 0) return Array.Empty<float>();
        if (keepTiming) return samples;
        var from = Math.Max(0, first - PadSamples);
        var to = Math.Min(samples.Length, last + PadSamples);
        offsetMs = 0; // times are of the trimmed audio, as on the Mac
        return samples[from..to];
    }

    /// <summary>"en-US" and "en_US" both give "en"; the engines take the language part only.</summary>
    private static string Primary(string code)
    {
        var cut = code.IndexOfAny(new[] { '-', '_' });
        return (cut < 0 ? code : code[..cut]).Trim().ToLowerInvariant();
    }

    private static JsonObject Result(string text, string language, IReadOnlyList<SpeechSegment> segments, int decodeMs, int audioMs) => new()
    {
        ["text"] = text,
        ["language"] = language,
        ["segments"] = new JsonArray(segments.Select(s => (JsonNode?)new JsonObject
        {
            ["startMs"] = Math.Max(0, s.StartMs),
            ["endMs"] = Math.Max(0, s.EndMs),
            ["text"] = s.Text,
            ["confidence"] = Math.Clamp(s.Confidence, 0, 1),
        }).ToArray()),
        ["decodeMs"] = decodeMs,
        ["audioMs"] = audioMs,
    };

    private void Enter()
    {
        lock (_gate)
        {
            if (_busy) throw new HelperException(ErrorCode.Busy, "A speech request is already running.");
            _busy = true;
        }
    }

    private void Leave()
    {
        lock (_gate) _busy = false;
    }
}
