using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Xunit;

namespace Murmur.Helper.Tests;

public class CaptureTests
{
    private static JsonObject Start(Rig rig, string id = "m1", int chunkSeconds = 1, params string[] channels) => new()
    {
        ["meetingId"] = id,
        ["folder"] = Path.Combine(rig.Folder, id),
        ["channels"] = new JsonArray((channels.Length == 0 ? new[] { "mic", "system" } : channels).Select(c => (JsonNode?)JsonValue.Create(c)).ToArray()),
        ["chunkSeconds"] = chunkSeconds,
    };

    [Fact]
    public void RecordsBothChannelsIntoChunkFilesAndReportsEachWithItsHash()
    {
        using var rig = new Rig();
        var started = rig.Call("capture.start", Start(rig));
        Assert.Equal("Test microphone", started["channels"]!["mic"]!.GetValue<string>());
        Assert.Equal("Test output", started["channels"]!["system"]!.GetValue<string>());
        Assert.Empty(started["warnings"]!.AsArray());

        var stopped = rig.Call("capture.stop", new JsonObject { ["meetingId"] = "m1" });
        var chunks = rig.Events.Where(e => e.Type == "capture.chunk").Select(e => e.Payload).ToList();
        Assert.Equal(2, chunks.Count);
        foreach (var chunk in chunks)
        {
            var path = chunk["path"]!.GetValue<string>();
            Assert.True(File.Exists(path));
            Assert.DoesNotContain(".partial.", path);
            Assert.Equal(Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant(), chunk["sha256"]!.GetValue<string>());
            Assert.Equal(1, chunk["seq"]!.GetValue<int>());
            Assert.Equal(0L, chunk["startMs"]!.GetValue<long>());
            Assert.Equal(1000L, chunk["durationMs"]!.GetValue<long>());
        }
        Assert.Equal(1, stopped["channels"]!["mic"]!["chunks"]!.GetValue<int>());
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(rig.Folder, "m1"), "*.partial.*"));
    }

    [Fact]
    public void ChunksCloseAtTheChunkLengthAndTheLastOneIsClosedOnStop()
    {
        using var rig = new Rig();
        var factory = new Factory();
        var capture = new MeetingCapture(factory, rig.World.PermissionState, (t, p) => rig.Events.Add((t, p)), () => 1);
        capture.Start(Start(rig, "m2", chunkSeconds: 2, "mic"));
        factory.Mic.Push(new float[16000 * 3]); // 3 s: one 2 s chunk closed, 1 s open
        Assert.Single(rig.Events, e => e.Type == "capture.chunk");
        capture.Stop(new JsonObject { ["meetingId"] = "m2" });
        var chunks = rig.Events.Where(e => e.Type == "capture.chunk").Select(e => e.Payload).ToList();
        Assert.Equal(new[] { 1, 2 }, chunks.Select(c => c["seq"]!.GetValue<int>()));
        Assert.Equal(new[] { 0, 2000 }, chunks.Select(c => (int)c["startMs"]!.GetValue<long>()));
        Assert.Equal(new[] { 2000, 1000 }, chunks.Select(c => (int)c["durationMs"]!.GetValue<long>()));
    }

    [Fact]
    public void WarnsAndGoesOnWithTheMicrophoneWhenTheSystemSoundCannotBeCaptured()
    {
        using var rig = new Rig();
        rig.World.AudioState.SystemAvailable = false;
        var started = rig.Call("capture.start", Start(rig));
        Assert.Equal("system_unavailable", started["warnings"]![0]!.GetValue<string>());
        Assert.Null(started["channels"]!["system"]);
        rig.Call("capture.stop", new JsonObject { ["meetingId"] = "m1" });
    }

    [Fact]
    public void OneMeetingAtATimeAndAStopForAnotherIsNotFound()
    {
        using var rig = new Rig();
        rig.Call("capture.start", Start(rig));
        Assert.Equal(ErrorCode.Busy, Rig.Error(rig.Send("capture.start", Start(rig, "m9"))));
        Assert.Equal(ErrorCode.NotFound, Rig.Error(rig.Send("capture.stop", new JsonObject { ["meetingId"] = "other" })));
    }

    [Fact]
    public void RefusesARelativeFolderAndAWindowsFolderIsAccepted()
    {
        using var rig = new Rig();
        var relative = Start(rig); relative["folder"] = "meetings/m1";
        Assert.Equal(ErrorCode.InvalidPayload, Rig.Error(rig.Send("capture.start", relative)));
        Assert.True(Paths.IsAbsolute(@"C:\Users\me\meetings"));
        Assert.True(Paths.IsAbsolute(@"\\server\share\x"));
        Assert.False(Paths.IsAbsolute(@"..\x"));
    }

    [Fact]
    public void AMicrophoneThatIsOffMeansNoRecording()
    {
        using var rig = new Rig();
        rig.World.PermissionState.Values["microphone"] = "denied";
        Assert.Equal(ErrorCode.PermissionDenied, Rig.Error(rig.Send("capture.start", Start(rig))));
        rig.World.PermissionState.Values["microphone"] = "granted";
        rig.Call("capture.start", Start(rig)); // the failed start left nothing running
    }

    [Fact]
    public void AChannelProblemIsReportedAndTheRecordingGoesOn()
    {
        using var rig = new Rig();
        var factory = new Factory();
        var capture = new MeetingCapture(factory, rig.World.PermissionState, (t, p) => rig.Events.Add((t, p)), () => 1);
        capture.Start(Start(rig, "m3", 5, "mic"));
        factory.Mic.Fail("device_lost");
        var error = rig.Events.Single(e => e.Type == "capture.error").Payload;
        Assert.Equal("device_lost", error["code"]!.GetValue<string>());
        Assert.Equal("mic", error["channel"]!.GetValue<string>());
    }

    private sealed class Factory : IAudioSourceFactory
    {
        public readonly FakeWorld.Source Mic = new("Mic", tone: false);
        public IReadOnlyList<AudioDeviceInfo> Devices() => Array.Empty<AudioDeviceInfo>();
        public IAudioSource Microphone(string? deviceId) => Mic;
        public IAudioSource? SystemOutput() => null;
    }
}
