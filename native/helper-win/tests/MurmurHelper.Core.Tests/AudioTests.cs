using System.Text.Json.Nodes;
using Xunit;

namespace Murmur.Helper.Tests;

public class AudioTests
{
    private static JsonObject Start(string id, bool levels = false, bool test = false) => new()
    {
        ["sessionId"] = id, ["emitLevels"] = levels, ["levelIntervalMs"] = 100, ["test"] = test,
    };

    [Fact]
    public void ARecordingWritesAWavAndReportsItsStatistics()
    {
        using var rig = new Rig();
        var started = rig.Call("audio.start", Start("s1"));
        Assert.Equal(16000, started["sampleRate"]!.GetValue<int>());
        Assert.Equal("Test microphone", started["deviceName"]!.GetValue<string>());
        var stopped = rig.Call("audio.stop", new JsonObject { ["sessionId"] = "s1" });
        Assert.Equal(1000L, stopped["durationMs"]!.GetValue<long>());
        Assert.False(stopped["silent"]!.GetValue<bool>());
        var file = stopped["audioFile"]!.AsObject();
        Assert.Equal("pcm_s16le", file["codec"]!.GetValue<string>());
        var bytes = File.ReadAllBytes(file["path"]!.GetValue<string>());
        Assert.Equal("RIFF", System.Text.Encoding.ASCII.GetString(bytes, 0, 4));
        Assert.Equal(44 + 32000, bytes.Length);
        Assert.Equal(bytes.Length, file["bytes"]!.GetValue<long>());
    }

    [Fact]
    public void OneSessionAtATimeAndACancelledOneLeavesNothing()
    {
        using var rig = new Rig();
        rig.Call("audio.start", Start("s1"));
        Assert.Equal(ErrorCode.Busy, Rig.Error(rig.Send("audio.start", Start("s2"))));
        Assert.True(rig.Call("audio.cancel", new JsonObject { ["sessionId"] = "s1" })["discarded"]!.GetValue<bool>());
        Assert.False(Directory.EnumerateFiles(Path.Combine(rig.Folder, "audio")).Any());
        Assert.False(rig.Call("audio.cancel", new JsonObject { ["sessionId"] = "s1" })["discarded"]!.GetValue<bool>());
        rig.Call("audio.start", Start("s3"));
        Assert.Equal(ErrorCode.NotFound, Rig.Error(rig.Send("audio.stop", new JsonObject { ["sessionId"] = "s1" })));
    }

    [Fact]
    public void ARefusedMicrophoneIsPermissionDeniedAndNothingStarts()
    {
        using var rig = new Rig();
        rig.World.PermissionState.Values["microphone"] = "denied";
        Assert.Equal(ErrorCode.PermissionDenied, Rig.Error(rig.Send("audio.start", Start("s1"))));
        rig.World.PermissionState.Values["microphone"] = "granted";
        rig.Call("audio.start", Start("s1"));
    }

    [Fact]
    public void AMicrophoneCheckWritesNoFile()
    {
        using var rig = new Rig();
        rig.Call("audio.start", Start("check", test: true));
        var stopped = rig.Call("audio.stop", new JsonObject { ["sessionId"] = "check" });
        Assert.Null(stopped["audioFile"]);
    }

    [Fact]
    public void SilenceIsReportedOnceAfterThreeSecondsAndTheSessionIsSilent()
    {
        using var rig = new Rig();
        var factory = new SilentFactory();
        var mic = new MicSession(factory, rig.World.PermissionState, (t, p) => rig.Events.Add((t, p)), () => 1, Path.Combine(rig.Folder, "silent"));
        mic.Start(Start("quiet"));
        factory.Source.Push(new float[16000 * 4]);
        factory.Source.Push(new float[16000]);
        Assert.Single(rig.Events, e => e.Type == "audio.silent");
        var stopped = mic.Stop(new JsonObject { ["sessionId"] = "quiet" });
        Assert.True(stopped["silent"]!.GetValue<bool>());
    }

    [Fact]
    public void LevelsArriveAtTheAskedInterval()
    {
        using var rig = new Rig();
        rig.Call("audio.start", Start("lv", levels: true));
        var levels = rig.Events.Where(e => e.Type == "audio.level").ToList();
        Assert.Equal(10, levels.Count); // one second of tone, one level every 100 ms
        Assert.InRange(levels[0].Payload["peakDb"]!.GetValue<double>(), -12, -8);
        Assert.Equal("mic", levels[0].Payload["source"]!.GetValue<string>());
    }

    [Fact]
    public void WhisperModeRaisesTheGain()
    {
        using var rig = new Rig();
        var quiet = new float[16000];
        Array.Fill(quiet, 0.01f);
        var factory = new SilentFactory();
        var mic = new MicSession(factory, rig.World.PermissionState, (_, _) => { }, () => 1, Path.Combine(rig.Folder, "w"));
        var request = Start("w"); request["whisper"] = true;
        mic.Start(request);
        factory.Source.Push(quiet);
        var stopped = mic.Stop(new JsonObject { ["sessionId"] = "w" });
        Assert.InRange(stopped["peakDb"]!.GetValue<double>(), -11, -9); // 0.01 + 30 dB = about 0.316
    }

    [Fact]
    public void ListsTheDevicesAndRefusesAnUnknownOne()
    {
        using var rig = new Rig();
        var devices = rig.Call("audio.devices")["devices"]!.AsArray();
        Assert.Equal("mic-1", devices[0]!["id"]!.GetValue<string>());
        var request = Start("x"); request["deviceId"] = "nope";
        Assert.Equal(ErrorCode.DeviceNotFound, Rig.Error(rig.Send("audio.start", request)));
    }

    private sealed class SilentFactory : IAudioSourceFactory
    {
        public readonly FakeWorld.Source Source = new("Silent", tone: false);
        public IReadOnlyList<AudioDeviceInfo> Devices() => Array.Empty<AudioDeviceInfo>();
        public IAudioSource Microphone(string? deviceId) => Source;
        public IAudioSource? SystemOutput() => null;
    }
}

public class WavTests
{
    [Fact]
    public void MeasuresLevelsInDecibels()
    {
        var (rms, peak) = Levels.Measure(new[] { 0.5f, -0.5f, 0.5f, -0.5f });
        Assert.Equal(-6.02, rms, 1);
        Assert.Equal(-6.02, peak, 1);
        Assert.Equal(Levels.FloorDb, Levels.Measure(new float[8]).RmsDb);
    }
}
