using System.Text.Json.Nodes;
using Xunit;

namespace Murmur.Helper.Tests;

public class TypingTests
{
    private const int F9 = 0x78, Space = 0x20, Enter = 0x0D, Back = 0x08, Control = 0xA2, RightAlt = 0xA5, Windows = 0x5B, Left = 0x25;

    private static void Press(Rig rig, int vk, bool down) =>
        rig.Act(new JsonObject { ["op"] = "key", ["keyCode"] = vk, ["modifiers"] = new JsonArray(), ["down"] = down });

    private static void Tap(Rig rig, params int[] keys)
    {
        foreach (var vk in keys)
        {
            Press(rig, vk, true);
            Press(rig, vk, false);
        }
    }

    private static List<int> Reports(Rig rig)
    {
        rig.Act(new JsonObject { ["op"] = "typingReport" });
        return rig.Events.Where(e => e.Type == "typing.activity").Select(e => e.Payload["words"]!.GetValue<int>()).ToList();
    }

    private static Rig Watching()
    {
        var rig = new Rig();
        rig.Call("typing.watch", new JsonObject { ["enabled"] = true });
        return rig;
    }

    [Fact]
    public void CountsWordsEndedBySpaceOrEnterAndStartsAfresh()
    {
        using var rig = Watching();
        Tap(rig, 'A', 'B', Space, Space, 'C', Back, 'D', Enter, 'E');
        Assert.Equal(new[] { 2 }, Reports(rig));
        // The word still being typed is counted when it ends.
        rig.Events.Clear();
        Tap(rig, Space);
        Assert.Equal(new[] { 1 }, Reports(rig));
    }

    [Fact]
    public void ShortcutsArrowsAndFunctionKeysAreNotTyping()
    {
        using var rig = Watching();
        foreach (var modifier in new[] { Control, RightAlt, Windows })
        {
            Press(rig, modifier, true);
            Tap(rig, 'C', Space);
            Press(rig, modifier, false);
        }
        Tap(rig, Left, F9, Space);
        Assert.Empty(Reports(rig));
    }

    [Fact]
    public void AltGrTypes()
    {
        using var rig = Watching();
        Press(rig, Control, true);
        Press(rig, RightAlt, true);
        Tap(rig, 'E', Space);
        Assert.Equal(new[] { 1 }, Reports(rig));
    }

    [Fact]
    public void HeldKeysCountOnceAndNothingIsCountedWhenOff()
    {
        using var rig = Watching();
        Press(rig, 'A', true);
        Press(rig, Space, true);
        Press(rig, Space, true);
        Press(rig, Space, false);
        Assert.Equal(new[] { 1 }, Reports(rig));
        rig.Events.Clear();
        rig.Call("typing.watch", new JsonObject { ["enabled"] = false });
        Tap(rig, 'B', Space);
        Assert.Empty(Reports(rig));
    }
}

public class PlaybackTests
{
    [Fact]
    public void PausesOnlyWhatIsPlayingAndPlaysItAgain()
    {
        using var rig = new Rig();
        Assert.True(rig.Call("media.playback")["playing"]!.GetValue<bool>());
        Assert.True(rig.Call("media.pause")["paused"]!.GetValue<bool>());
        Assert.False(rig.Call("media.pause")["paused"]!.GetValue<bool>());
        Assert.True(rig.Call("media.resume")["resumed"]!.GetValue<bool>());
        Assert.False(rig.Call("media.resume")["resumed"]!.GetValue<bool>());
    }

    [Fact]
    public void SaysWhenTheSystemDoesNotReportPlayback()
    {
        using var rig = new Rig();
        rig.World.PlayerState.Playing = null;
        var playback = rig.Call("media.playback");
        Assert.False(playback["available"]!.GetValue<bool>());
        Assert.Null(playback["playing"]);
        Assert.Equal(ErrorCode.DeviceNotFound, Rig.Error(rig.Send("media.pause")));
        Assert.Equal(ErrorCode.DeviceNotFound, Rig.Error(rig.Send("media.resume")));
    }
}

public class DeviceChangeTests
{
    private static MicSession Session(FakeWorld world, List<(string Type, JsonObject Payload)> events, string folder) =>
        new(world.AudioState, world.PermissionState, (type, payload) => events.Add((type, payload)), () => 0, folder);

    private static void Run(Action<FakeWorld, MicSession, List<(string Type, JsonObject Payload)>> body)
    {
        var world = new FakeWorld((_, _) => { }, () => 0);
        world.PermissionState.Values["microphone"] = "granted";
        world.AudioState.Inputs.Add(new AudioDeviceInfo("usb", "USB microphone", false, "usb", 48000));
        var events = new List<(string, JsonObject)>();
        var folder = Path.Combine(Path.GetTempPath(), "murmur-devices-" + Guid.NewGuid().ToString("N"));
        var mic = Session(world, events, folder);
        try { body(world, mic, events); }
        finally
        {
            mic.Shutdown();
            try { Directory.Delete(folder, true); } catch { /* not made */ }
        }
    }

    private static JsonObject Start(string? device) => new()
    {
        ["sessionId"] = "s1", ["deviceId"] = device, ["emitLevels"] = false, ["levelIntervalMs"] = 100,
    };

    private static JsonObject? Route(List<(string Type, JsonObject Payload)> events) =>
        events.Where(e => e.Type == "audio.route.changed").Select(e => e.Payload).SingleOrDefault();

    [Fact]
    public void SendsTheNewListAndLeavesAWorkingSessionAlone() => Run((world, mic, events) =>
    {
        mic.Start(Start("usb"));
        world.AudioState.Inputs.RemoveAll(d => d.Id == "mic-1");
        mic.ApplyDeviceChange();
        var list = events.Single(e => e.Type == "audio.devices.changed").Payload["devices"]!.AsArray();
        Assert.Equal("usb", Assert.Single(list)!["id"]!.GetValue<string>());
        Assert.Null(Route(events));
    });

    [Fact]
    public void MovesARunningSessionToTheDefaultIntoTheSameFile() => Run((world, mic, events) =>
    {
        mic.Start(Start("usb"));
        var first = world.AudioState.Last!;
        world.AudioState.Inputs.RemoveAll(d => d.Id == "usb");
        mic.ApplyDeviceChange();
        Assert.Equal("device-removed", Route(events)!["reason"]!.GetValue<string>());
        Assert.Equal("Test microphone", Route(events)!["deviceName"]!.GetValue<string>());
        // The old device's samples are dropped; both devices' tones are in the one file.
        first.Push(new float[16000]);
        var stopped = mic.Stop(new JsonObject { ["sessionId"] = "s1" });
        Assert.Equal(32000, stopped["samples"]!.GetValue<long>());
    });

    [Fact]
    public void RestartsASessionWhoseCaptureStopped() => Run((world, mic, events) =>
    {
        mic.Start(Start("usb"));
        world.AudioState.Last!.Fail("device_lost");
        mic.ApplyDeviceChange();
        Assert.Equal("interrupted", Route(events)!["reason"]!.GetValue<string>());
        Assert.Equal("USB microphone", Route(events)!["deviceName"]!.GetValue<string>());
    });

    [Fact]
    public void SaysWhenNoInputCanBeStarted() => Run((world, mic, events) =>
    {
        mic.Start(Start(null));
        world.AudioState.Inputs.Clear();
        mic.ApplyDeviceChange();
        Assert.Null(Route(events)!["deviceName"]);
    });

    [Fact]
    public void ActsOnABurstOfChangesOnceItSettles() => Run((world, mic, events) =>
    {
        world.AudioState.Changed();
        world.AudioState.Changed();
        Assert.True(SpinWait.SpinUntil(() => events.Count > 0, 3000));
        Thread.Sleep(200);
        Assert.Single(events);
    });
}
