using System.Text.Json.Nodes;
using Xunit;

namespace Murmur.Helper.Tests;

public class WatcherTests
{
    [Fact]
    public void ReportsTheFrontAppOnceAtStartAndOnEachChangeOnly()
    {
        var events = new List<JsonObject>();
        FrontAppInfo? current = new("a.exe", "Doc - A", 1);
        var watch = new FrontAppWatch(() => current, (_, p) => events.Add(p));
        watch.Tick();
        Assert.Empty(events); // not watching yet
        watch.Watch(true);
        Assert.Single(events);
        watch.Tick();
        Assert.Single(events); // no change
        current = new("b.exe", "B", 2);
        watch.Tick();
        Assert.Equal(2, events.Count);
        Assert.Equal("b.exe", events[1]["bundleId"]!.GetValue<string>());
        watch.Watch(false);
        current = new("c.exe", "C", 3);
        watch.Tick();
        Assert.Equal(2, events.Count);
    }

    private static readonly IReadOnlyList<MeetingMatcher> Matchers = new[]
    {
        new MeetingMatcher("zoom", new[] { "Zoom.exe" }, new[] { "Zoom Meeting" }),
        new MeetingMatcher("teams", new[] { "ms-teams.exe", "Teams.exe" }, new[] { "Meeting with", "Call with" }),
    };

    [Fact]
    public void MatchesByProcessNameAndTitleWordInAnyCase()
    {
        var active = MatcherEvaluator.Active(Matchers, new[]
        {
            new WindowInfo("zoom.EXE", "zoom meeting - 40 minutes"),
            new WindowInfo("chrome.exe", "Meeting with Bea"),
        });
        Assert.Equal(new[] { "zoom" }, active);
    }

    [Fact]
    public void AWordInTheTitleOfAnotherProgramIsNotACall()
    {
        Assert.Empty(MatcherEvaluator.Active(Matchers, new[] { new WindowInfo("notepad.exe", "Zoom Meeting notes") }));
    }

    [Fact]
    public void SaysWhenACallStartsAndEndsAndNeverCarriesATitle()
    {
        var events = new List<JsonObject>();
        var windows = new List<WindowInfo>();
        var detection = new MeetingDetection(() => windows.ToList(), (_, p) => events.Add(p));
        detection.Tick();
        Assert.Empty(events);
        detection.Subscribe(true, Matchers);
        windows.Add(new WindowInfo("ms-teams.exe", "Call with Bea"));
        detection.Tick();
        detection.Tick();
        windows.Clear();
        detection.Tick();
        Assert.Equal(2, events.Count);
        Assert.True(events[0]["active"]!.GetValue<bool>());
        Assert.False(events[1]["active"]!.GetValue<bool>());
        Assert.DoesNotContain("Bea", string.Concat(events.Select(e => e.ToJsonString())));
        detection.Subscribe(false, Array.Empty<MeetingMatcher>());
        windows.Add(new WindowInfo("ms-teams.exe", "Call with Bea"));
        detection.Tick();
        Assert.Equal(2, events.Count);
    }

    [Fact]
    public void OnlyMatchersWithAWindowsPartAreUsed()
    {
        var json = JsonNode.Parse("""
            [{"id":"zoom","name":"Zoom","native":{"bundleIds":["us.zoom.xos"],"titles":["Zoom Meeting"]},"windows":{"processes":["Zoom.exe"],"titles":["Zoom Meeting"]}},
             {"id":"facetime","name":"FaceTime","native":{"bundleIds":["x"],"titles":["y"]}}]
            """)!.AsArray();
        var parsed = MeetingMatcher.ParseAll(json);
        Assert.Equal(new[] { "zoom" }, parsed.Select(m => m.Id));
    }
}
