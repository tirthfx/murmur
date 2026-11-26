using System.Text.Json.Nodes;
using Xunit;

namespace Murmur.Helper.Tests;

public sealed class SpeechRig : IDisposable
{
    public readonly Rig Rig = new();
    public readonly string Folder = Path.Combine(Path.GetTempPath(), "murmur-speech-tests-" + Guid.NewGuid().ToString("N"));
    public FakeSpeechEngine Engine => Rig.World.Speech;

    public SpeechRig() => Directory.CreateDirectory(Folder);

    /// <summary>A WAV with a tone between two stretches of silence, in seconds.</summary>
    public string Wav(double leading, double tone, double trailing, string name = "a.wav")
    {
        var path = Path.Combine(Folder, name);
        using (var writer = new WavWriter(path))
        {
            writer.Write(new float[(int)(leading * WavWriter.SampleRate)]);
            var voice = new float[(int)(tone * WavWriter.SampleRate)];
            for (var i = 0; i < voice.Length; i++) voice[i] = 0.3f * MathF.Sin(i * 0.2f);
            writer.Write(voice);
            writer.Write(new float[(int)(trailing * WavWriter.SampleRate)]);
        }
        return path;
    }

    public JsonObject Load() => Rig.Call("transcribe.load", new JsonObject
    {
        ["model"] = "fake-model", ["modelDir"] = Folder, ["tokenizerDir"] = Folder,
    });

    public JsonObject File(string path, params string[] languages) => Rig.Call("transcribe.file", Payload(path, languages));

    public static JsonObject Payload(string path, params string[] languages) => new()
    {
        ["path"] = path,
        ["languages"] = new JsonArray(languages.Select(l => (JsonNode?)JsonValue.Create(l)).ToArray()),
    };

    public void Dispose()
    {
        Rig.Dispose();
        try { Directory.Delete(Folder, recursive: true); } catch { /* already gone */ }
    }
}

public class SpeechTests
{
    [Fact]
    public void TheHelperAnnouncesSpeechOnlyWhenItHasAnEngine()
    {
        using var rig = new SpeechRig();
        var hello = rig.Rig.Router.HelloEvent().Payload["capabilities"]!.AsArray().Select(c => c!.GetValue<string>()).ToList();
        Assert.Contains("transcribe.file", hello);
        Assert.Contains("transcribe.prompt", hello);
        Assert.Contains("transcribe.translate", hello);

        var bare = new Router(new Backends { Permissions = rig.Rig.World.Backends().Permissions }, null, null);
        Assert.DoesNotContain("transcribe.file", bare.Capabilities());
    }

    [Fact]
    public void LoadingReportsTheModelAndWhatItRunsOn()
    {
        using var rig = new SpeechRig();
        var loaded = rig.Load();
        Assert.Equal("fake-model", loaded["loadedModel"]!.GetValue<string>());
        Assert.Equal("fake", loaded["computeUnits"]!.GetValue<string>());
        Assert.True(loaded["loadMs"]!.GetValue<int>() >= 0);
        Assert.Equal(rig.Folder, rig.Engine.LoadedFrom);
    }

    [Fact]
    public void AFailedLoadIsReportedAndLeavesNothingLoaded()
    {
        using var rig = new SpeechRig();
        rig.Engine.FailLoadWith = "bad file";
        var failed = rig.Rig.Send("transcribe.load", new JsonObject { ["model"] = "m", ["modelDir"] = rig.Folder, ["tokenizerDir"] = rig.Folder });
        Assert.Equal("MODEL_LOAD_FAILED", Rig.Error(failed));
        Assert.Equal("MODEL_NOT_LOADED", Rig.Error(rig.Rig.Send("transcribe.file", SpeechRig.Payload(rig.Wav(0, 1, 0)))));
    }

    [Fact]
    public void TranscribingNeedsALoadedModel()
    {
        using var rig = new SpeechRig();
        Assert.Equal("MODEL_NOT_LOADED", Rig.Error(rig.Rig.Send("transcribe.file", SpeechRig.Payload(rig.Wav(0, 1, 0)))));
        rig.Load();
        rig.Rig.Call("transcribe.unload");
        Assert.Equal("MODEL_NOT_LOADED", Rig.Error(rig.Rig.Send("transcribe.file", SpeechRig.Payload(rig.Wav(0, 1, 0)))));
    }

    [Fact]
    public void ATranscriptCarriesTextLanguageSegmentsAndTimes()
    {
        using var rig = new SpeechRig();
        rig.Load();
        var done = rig.File(rig.Wav(0.5, 1.0, 0.5));
        Assert.Equal(FakeSpeechEngine.Sentence, done["text"]!.GetValue<string>());
        Assert.Equal("en", done["language"]!.GetValue<string>());
        Assert.Equal(2000, done["audioMs"]!.GetValue<int>());
        var segment = done["segments"]!.AsArray().Single()!.AsObject();
        Assert.Equal(FakeSpeechEngine.Sentence, segment["text"]!.GetValue<string>());
        Assert.InRange(segment["confidence"]!.GetValue<double>(), 0, 1);
        Assert.True(segment["endMs"]!.GetValue<int>() > segment["startMs"]!.GetValue<int>());
    }

    [Fact]
    public void SilenceIsTrimmedFromBothEndsUnlessTimingMustMatch()
    {
        using var rig = new SpeechRig();
        rig.Load();
        var path = rig.Wav(3, 1, 3);
        rig.File(path);
        // 1 s of tone plus 150 ms kept on each side.
        Assert.InRange(rig.Engine.LastSampleCount, 16000 + 4000, 16000 + 5000);

        var payload = SpeechRig.Payload(path);
        payload["keepTiming"] = true;
        rig.Rig.Call("transcribe.file", payload);
        Assert.Equal(7 * 16000, rig.Engine.LastSampleCount);
    }

    [Fact]
    public void AFileWithNoSoundGivesNoTextAndNoEngineCall()
    {
        using var rig = new SpeechRig();
        rig.Load();
        var done = rig.File(rig.Wav(2, 0, 0, "quiet.wav"), "de");
        Assert.Equal("", done["text"]!.GetValue<string>());
        Assert.Empty(done["segments"]!.AsArray());
        Assert.Equal(0, rig.Engine.Calls);
    }

    [Fact]
    public void NoLanguagesDetectsOneLanguageForcesIt()
    {
        using var rig = new SpeechRig();
        rig.Load();
        var path = rig.Wav(0, 1, 0);
        rig.File(path);
        Assert.Null(rig.Engine.LastLanguage);
        var forced = rig.File(path, "fr-CA");
        Assert.Equal("fr", rig.Engine.LastLanguage);
        Assert.Equal("fr", forced["language"]!.GetValue<string>());
    }

    [Fact]
    public void SeveralLanguagesKeepTheDetectedOneOnlyIfItWasChosen()
    {
        using var rig = new SpeechRig();
        rig.Load();
        var path = rig.Wav(0, 1, 0);

        rig.Engine.Detects = "de";
        var chosen = rig.File(path, "en", "de");
        Assert.Equal("de", chosen["language"]!.GetValue<string>());
        Assert.Equal(1, rig.Engine.Calls);

        rig.Engine.Detects = "ja"; // not among the choices: run again in the first choice
        var other = rig.File(path, "en", "de");
        Assert.Equal("en", other["language"]!.GetValue<string>());
        Assert.Equal("en", rig.Engine.LastLanguage);
        Assert.Equal(3, rig.Engine.Calls);
    }

    [Fact]
    public void PromptAndTranslateReachTheEngine()
    {
        using var rig = new SpeechRig();
        rig.Load();
        var payload = SpeechRig.Payload(rig.Wav(0, 1, 0));
        payload["prompt"] = "Murmur, Supabase";
        payload["translate"] = true;
        rig.Rig.Call("transcribe.file", payload);
        Assert.Equal("Murmur, Supabase", rig.Engine.LastPrompt);
        Assert.True(rig.Engine.LastTranslate);
    }

    [Fact]
    public void ATimeLimitCancelsTheEngineAndIsReported()
    {
        using var rig = new SpeechRig();
        rig.Load();
        rig.Engine.OnTranscribe = _ => throw new OperationCanceledException();
        Assert.Equal("TRANSCRIPTION_TIMEOUT", Rig.Error(rig.Rig.Send("transcribe.file", SpeechRig.Payload(rig.Wav(0, 1, 0)))));
    }

    [Fact]
    public void AnEngineFailureIsReported()
    {
        using var rig = new SpeechRig();
        rig.Load();
        rig.Engine.OnTranscribe = _ => throw new InvalidOperationException("decoder broke");
        var failed = rig.Rig.Send("transcribe.file", SpeechRig.Payload(rig.Wav(0, 1, 0)));
        Assert.Equal("TRANSCRIPTION_FAILED", Rig.Error(failed));
        Assert.Contains("decoder broke", failed.Payload["error"]!["message"]!.GetValue<string>());
    }

    [Fact]
    public async Task OnlyOneSpeechRequestRunsAtATime()
    {
        using var rig = new SpeechRig();
        rig.Load();
        var path = rig.Wav(0, 1, 0);
        var started = new ManualResetEventSlim();
        var release = new ManualResetEventSlim();
        rig.Engine.OnTranscribe = _ => { started.Set(); release.Wait(5000); };

        var first = Task.Run(() => rig.Rig.Router.Handle(new Envelope("a", "transcribe.file", SpeechRig.Payload(path)).Encode()).Single());
        Assert.True(started.Wait(5000));
        var second = rig.Rig.Router.Handle(new Envelope("b", "transcribe.file", SpeechRig.Payload(path)).Encode()).Single();
        Assert.Equal("BUSY", Rig.Error(second));
        release.Set();
        Rig.Ok(await first);
    }

    [Fact]
    public void ASlowRequestAnswersLaterWhileAPingIsAnsweredAtOnce()
    {
        using var rig = new SpeechRig();
        rig.Load();
        var path = rig.Wav(0, 1, 0);
        var started = new ManualResetEventSlim();
        var release = new ManualResetEventSlim();
        rig.Engine.OnTranscribe = _ => { started.Set(); release.Wait(5000); };
        var later = new List<Envelope>();

        var immediate = rig.Rig.Router.Handle(new Envelope("slow", "transcribe.file", SpeechRig.Payload(path)).Encode(), e => { lock (later) later.Add(e); });
        Assert.Empty(immediate);
        Assert.True(started.Wait(5000));
        var ping = rig.Rig.Router.Handle(new Envelope("p", "ping", new JsonObject()).Encode(), e => { }).Single();
        Rig.Ok(ping);

        release.Set();
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (DateTime.UtcNow < deadline) { lock (later) if (later.Count > 0) break; Thread.Sleep(5); }
        lock (later)
        {
            var answer = Assert.Single(later);
            Assert.Equal("slow", answer.Id);
            Assert.Equal(FakeSpeechEngine.Sentence, Rig.Ok(answer)["text"]!.GetValue<string>());
        }
    }

    [Fact]
    public void ARequestBeforeTheHandshakeIsStillRefused()
    {
        using var rig = new SpeechRig();
        var bare = new Rig(handshake: false);
        var immediate = bare.Router.Handle(new Envelope("x", "transcribe.file", SpeechRig.Payload(rig.Wav(0, 1, 0))).Encode(), e => { }).Single();
        Assert.Equal("HANDSHAKE_REQUIRED", Rig.Error(immediate));
        bare.Dispose();
    }

    [Fact]
    public void AMissingFileIsNotFound()
    {
        using var rig = new SpeechRig();
        rig.Load();
        Assert.Equal("NOT_FOUND", Rig.Error(rig.Rig.Send("transcribe.file", SpeechRig.Payload(Path.Combine(rig.Folder, "nope.wav")))));
    }

    [Fact]
    public void ANonWavFileIsRefused()
    {
        using var rig = new SpeechRig();
        rig.Load();
        var path = Path.Combine(rig.Folder, "voice.m4a");
        File.WriteAllBytes(path, new byte[64]);
        Assert.Equal("INVALID_PAYLOAD", Rig.Error(rig.Rig.Send("transcribe.file", SpeechRig.Payload(path))));
    }
}

public class WavReaderTests
{
    private static byte[] Wav(short format, short channels, int rate, short bits, byte[] data, bool extensible = false)
    {
        using var stream = new MemoryStream();
        using var w = new BinaryWriter(stream);
        w.Write("RIFF"u8.ToArray()); w.Write(36 + data.Length); w.Write("WAVE"u8.ToArray());
        w.Write("LIST"u8.ToArray()); w.Write(4); w.Write("INFO"u8.ToArray()); // a chunk to skip
        w.Write("fmt "u8.ToArray()); w.Write(16);
        w.Write(format); w.Write(channels); w.Write(rate); w.Write(rate * channels * bits / 8);
        w.Write((short)(channels * bits / 8)); w.Write(bits);
        w.Write("data"u8.ToArray()); w.Write(data.Length); w.Write(data);
        return stream.ToArray();
    }

    [Fact]
    public void ReadsSixteenBitMonoAt16kHzAsIs()
    {
        var data = new byte[4];
        BitConverter.TryWriteBytes(data.AsSpan(0), (short)16384);
        BitConverter.TryWriteBytes(data.AsSpan(2), (short)-16384);
        var samples = WavReader.Decode(Wav(1, 1, 16000, 16, data));
        Assert.Equal(2, samples.Length);
        Assert.Equal(0.5f, samples[0], 3);
        Assert.Equal(-0.5f, samples[1], 3);
    }

    [Fact]
    public void ReadsFloatStereoAt48kHzAsMono16k()
    {
        var frames = 4800; // 0.1 s
        var data = new byte[frames * 2 * 4];
        for (var i = 0; i < frames; i++)
        {
            BitConverter.TryWriteBytes(data.AsSpan(i * 8), 0.25f);
            BitConverter.TryWriteBytes(data.AsSpan(i * 8 + 4), 0.75f);
        }
        var samples = WavReader.Decode(Wav(3, 2, 48000, 32, data));
        Assert.InRange(samples.Length, 1590, 1610);
        Assert.Equal(0.5f, samples[100], 3);
    }

    [Fact]
    public void ATruncatedFileGivesWhatIsThere()
    {
        var bytes = Wav(1, 1, 16000, 16, new byte[1000]);
        var cut = bytes[..(bytes.Length - 400)];
        Assert.Equal(300, WavReader.Decode(cut).Length);
    }

    [Theory]
    [InlineData(new byte[] { 1, 2, 3 })]
    public void RefusesWhatIsNotWav(byte[] bytes) =>
        Assert.Equal("INVALID_PAYLOAD", Assert.Throws<HelperException>(() => WavReader.Decode(bytes)).Code);

    [Fact]
    public void RefusesAFormatItCannotRead() =>
        Assert.Equal("INVALID_PAYLOAD", Assert.Throws<HelperException>(() => WavReader.Decode(Wav(1, 1, 16000, 24, new byte[30]))).Code);
}

public class LiveTranscriptionTests
{
    private sealed class Factory : IAudioSourceFactory
    {
        public readonly FakeWorld.Source Mic = new("Mic", tone: false);
        public IReadOnlyList<AudioDeviceInfo> Devices() => Array.Empty<AudioDeviceInfo>();
        public IAudioSource Microphone(string? deviceId) => Mic;
        public IAudioSource? SystemOutput() => null;
        public event Action? DevicesChanged { add { } remove { } }
    }

    /// <summary>A router with a meeting recording on the fake microphone, one 2 s chunk at a time.</summary>
    private static (Router Router, Factory Factory, SpeechRig Rig) Start()
    {
        var rig = new SpeechRig();
        var factory = new Factory();
        var capture = new MeetingCapture(factory, rig.Rig.World.PermissionState, (t, p) => rig.Rig.Events.Add((t, p)), () => 1);
        var backends = rig.Rig.World.Backends();
        var router = new Router(backends, null, capture);
        router.Handle(new Envelope("ack", "hello.ack", new JsonObject { ["accepted"] = true, ["protocolVersion"] = ProtocolConstants.ProtocolVersion, ["appVersion"] = "1" }).Encode());
        Send(router, "transcribe.load", new JsonObject { ["model"] = "m", ["modelDir"] = rig.Folder, ["tokenizerDir"] = rig.Folder });
        Send(router, "capture.start", new JsonObject
        {
            ["meetingId"] = "live-1", ["folder"] = Path.Combine(rig.Folder, "live"),
            ["channels"] = new JsonArray("mic"), ["chunkSeconds"] = 2,
        });
        return (router, factory, rig);
    }

    private static Envelope Send(Router router, string type, JsonObject payload) =>
        router.Handle(new Envelope("m-" + type, type, payload).Encode()).Single();

    private static JsonObject Live(Router router, string channel = "mic", string meeting = "live-1") =>
        Rig.Ok(Send(router, "transcribe.live", new JsonObject { ["meetingId"] = meeting, ["channel"] = channel }));

    private static float[] Tone(int samples)
    {
        var tone = new float[samples];
        for (var i = 0; i < samples; i++) tone[i] = 0.3f * MathF.Sin(i * 0.2f);
        return tone;
    }

    [Fact]
    public void TheHelperAnnouncesLiveTextWhenItCanRecordAndTranscribe()
    {
        var (router, _, rig) = Start();
        using (rig) Assert.Contains("transcribe.live", router.Capabilities());
    }

    [Fact]
    public void UnderASecondOfAudioGivesNoTextYet()
    {
        var (router, factory, rig) = Start();
        using (rig)
        {
            factory.Mic.Push(Tone(8000));
            var result = Live(router);
            Assert.Equal("", result["text"]!.GetValue<string>());
            Assert.Empty(result["segments"]!.AsArray());
            Assert.Equal(500, result["audioMs"]!.GetValue<int>());
            Assert.Equal(1, result["seq"]!.GetValue<int>());
            Assert.Equal("mic", result["channel"]!.GetValue<string>());
            Assert.Equal(0, rig.Engine.Calls);
        }
    }

    [Fact]
    public void TextForTheChunkSoFarCarriesItsNumberAndPlaceOnTheTimeline()
    {
        var (router, factory, rig) = Start();
        using (rig)
        {
            factory.Mic.Push(Tone(16000 * 3)); // chunk 1 closed at 2 s, chunk 2 holds 1 s
            var result = Live(router);
            Assert.Equal(FakeSpeechEngine.Sentence, result["text"]!.GetValue<string>());
            Assert.Equal(2, result["seq"]!.GetValue<int>());
            Assert.Equal(2000L, result["startMs"]!.GetValue<long>());
            Assert.Equal(1000, result["audioMs"]!.GetValue<int>());
            Assert.Equal(16000, rig.Engine.LastSampleCount); // only the open chunk, untrimmed
        }
    }

    [Fact]
    public void BetweenChunksThereIsNothingAndTheNextChunkIsNamed()
    {
        var (router, factory, rig) = Start();
        using (rig)
        {
            factory.Mic.Push(Tone(16000 * 2)); // exactly one chunk, closed
            var result = Live(router);
            Assert.Equal(0, result["audioMs"]!.GetValue<int>());
            Assert.Equal(2, result["seq"]!.GetValue<int>());
            Assert.Equal(2000L, result["startMs"]!.GetValue<long>());
        }
    }

    [Fact]
    public void AChannelOrMeetingThatIsNotRecordedIsNotFound()
    {
        var (router, _, rig) = Start();
        using (rig)
        {
            Assert.Equal("NOT_FOUND", Rig.Error(Send(router, "transcribe.live", new JsonObject { ["meetingId"] = "live-1", ["channel"] = "system" })));
            Assert.Equal("NOT_FOUND", Rig.Error(Send(router, "transcribe.live", new JsonObject { ["meetingId"] = "other", ["channel"] = "mic" })));
            Assert.Equal("INVALID_PAYLOAD", Rig.Error(Send(router, "transcribe.live", new JsonObject { ["meetingId"] = "live-1", ["channel"] = "both" })));
        }
    }

    [Fact]
    public void LanguagesAndTranslateReachTheEngine()
    {
        var (router, factory, rig) = Start();
        using (rig)
        {
            factory.Mic.Push(Tone(16000 * 3));
            Rig.Ok(Send(router, "transcribe.live", new JsonObject
            {
                ["meetingId"] = "live-1", ["channel"] = "mic",
                ["languages"] = new JsonArray("de"), ["translate"] = true,
            }));
            Assert.Equal("de", rig.Engine.LastLanguage);
            Assert.True(rig.Engine.LastTranslate);
        }
    }
}
