using System.Text.Json.Nodes;
using Xunit;

namespace Murmur.Helper.Tests;

public class ContextTests
{
    private static Rig InNotepad()
    {
        var rig = new Rig();
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "notepad.exe", ["name"] = "Notepad" });
        return rig;
    }

    private static void Type(Rig rig, string text) => rig.Act(new JsonObject { ["op"] = "editField", ["text"] = text });

    [Fact]
    public void GivesTheAppTheWindowAndTheTextBeforeTheCaret()
    {
        using var rig = InNotepad();
        Type(rig, "first\r\nsecond");
        var context = rig.Call("context.snapshot");
        Assert.Equal("Notepad", context["appName"]!.GetValue<string>());
        Assert.Equal("notepad.exe", context["bundleId"]!.GetValue<string>());
        Assert.Equal("Untitled", context["windowTitle"]!.GetValue<string>());
        Assert.True(context["editable"]!.GetValue<bool>());
        Assert.Equal("first\nsecond", context["textBefore"]!.GetValue<string>());
        Assert.Equal("", context["textAfter"]!.GetValue<string>());
        Assert.Null(context["subrole"]);
    }

    [Fact]
    public void KeepsOnlyWhatIsNearestTheCaret()
    {
        using var rig = InNotepad();
        Type(rig, "abcdef");
        Assert.Equal("def", rig.Call("context.snapshot", new JsonObject { ["maxBefore"] = 3 })["textBefore"]!.GetValue<string>());
    }

    [Fact]
    public void APasswordFieldGivesNoText()
    {
        using var rig = InNotepad();
        Type(rig, "hunter2");
        rig.World.ReaderState.Secure = true;
        var context = rig.Call("context.snapshot");
        Assert.True(context["secure"]!.GetValue<bool>());
        Assert.Equal("", context["textBefore"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("maxBefore", 1501)]
    [InlineData("maxAfter", 301)]
    [InlineData("maxAfter", -1)]
    public void RefusesLimitsOutOfRange(string key, int value)
    {
        using var rig = InNotepad();
        Assert.Equal(ErrorCode.InvalidPayload, Rig.Error(rig.Send("context.snapshot", new JsonObject { [key] = value })));
    }

    [Fact]
    public void NeverSplitsACharacter()
    {
        Assert.Equal("b", ContextWindow.Before("a\U0001F600b", 2));
        Assert.Equal("a", ContextWindow.After("a\U0001F600b", 2));
        Assert.Equal("\U0001F600b", ContextWindow.Before("a\U0001F600b", 3));
    }
}

public class EditWatchTests
{
    [Theory]
    [InlineData("see you at the offce today", 0, 26, "see you at the office today", "offce", "office")]
    [InlineData("Note: meet Jon. Bye", 6, 9, "Note: meet John. Bye", "Jon.", "John.")]
    [InlineData("alpha beta", 0, 10, "alpha beta gamma", "", "gamma")]
    public void ReportsOnlyTheChangedWords(string old, int start, int length, string now, string before, string after)
    {
        var change = EditDiff.Compare(old, start, length, now)!;
        Assert.Equal(before, change.Before);
        Assert.Equal(after, change.After);
    }

    [Theory]
    [InlineData("one two three", 4, 3, "one two three")]
    [InlineData("one two three", 4, 3, "ONE two three")]
    [InlineData("one two three", 4, 3, "one two THREE")]
    [InlineData("one two three", 4, 3, "one")]
    public void ReportsNothingWhenTheSpanDidNotChangeOrCannotBeFound(string old, int start, int length, string now) =>
        Assert.Null(EditDiff.Compare(old, start, length, now));

    private sealed class Field : IWatchedFieldSource, IWatchedField
    {
        public volatile string? Text = "";
        public volatile bool HasFocus = true;
        public IWatchedField? Focused() => this;
        public string? Value() => Text;
        public bool IsFocused() => HasFocus;
    }

    private static JsonObject Watch(string text, int durationMs = 5000) => new() { ["text"] = text, ["durationMs"] = durationMs };

    private static bool Soon(Func<bool> check) => SpinWait.SpinUntil(check, 2000);

    [Fact]
    public void SendsACorrectionOnceItHasRested()
    {
        var field = new Field { Text = "hello wrold" };
        var seen = new System.Collections.Concurrent.ConcurrentQueue<JsonObject>();
        var watcher = new EditWatchController(field, (_, p) => seen.Enqueue(p), pollMs: 10, restPolls: 2);
        Assert.True(watcher.Watch(Watch("hello wrold"))["watching"]!.GetValue<bool>());
        field.Text = "hello world";
        Assert.True(Soon(() => !seen.IsEmpty));
        Thread.Sleep(80);
        var change = Assert.Single(seen);
        Assert.Equal("wrold", change["before"]!.GetValue<string>());
        Assert.Equal("world", change["after"]!.GetValue<string>());
        watcher.Cancel();
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void StopsWhenCancelledOrWhenTheFieldLosesFocus(bool cancel)
    {
        var field = new Field { Text = "hello wrold" };
        var seen = new System.Collections.Concurrent.ConcurrentQueue<JsonObject>();
        var watcher = new EditWatchController(field, (_, p) => seen.Enqueue(p), pollMs: 10, restPolls: 2);
        watcher.Watch(Watch("wrold"));
        if (cancel) watcher.Cancel(); else field.HasFocus = false;
        Thread.Sleep(40);
        field.Text = "hello world";
        Thread.Sleep(100);
        Assert.Empty(seen);
    }

    [Fact]
    public void DoesNotWatchWhenTheTextIsNotThere()
    {
        var watcher = new EditWatchController(new Field { Text = "something else" }, (_, _) => { });
        Assert.False(watcher.Watch(Watch("hello"))["watching"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData("", 5000)]
    [InlineData("x", 999)]
    [InlineData("x", 60001)]
    public void RefusesBadWatches(string text, int duration)
    {
        using var rig = new Rig();
        Assert.Equal(ErrorCode.InvalidPayload, Rig.Error(rig.Send("edits.watch", Watch(text, duration))));
    }
}

public class InspectorTests
{
    private static JsonObject Inspect(Rig rig, bool values) => rig.Call("ax.inspect", new JsonObject { ["showValues"] = values });

    [Fact]
    public void ListsTheFrontWindowWithValuesOnlyWhenAsked()
    {
        using var rig = new Rig();
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "notepad.exe", ["name"] = "Notepad" });
        rig.Act(new JsonObject { ["op"] = "editField", ["text"] = "words" });
        var hidden = Inspect(rig, false);
        Assert.Equal("notepad.exe", hidden["bundleId"]!.GetValue<string>());
        Assert.All(hidden["nodes"]!.AsArray(), n => Assert.Null(n!["value"]));
        var shown = Inspect(rig, true)["nodes"]!.AsArray();
        Assert.Equal(new[] { 0, 1 }, shown.Select(n => n!["depth"]!.GetValue<int>()));
        Assert.Equal("words", shown[1]!["value"]!.GetValue<string>());
        rig.World.ReaderState.Secure = true;
        var secret = Inspect(rig, true)["nodes"]!.AsArray()[1]!;
        Assert.True(secret["secure"]!.GetValue<bool>());
        Assert.Null(secret["value"]);
        Assert.Null(secret["selectedRange"]);
    }

    [Fact]
    public void IsEmptyWithNothingInFront()
    {
        using var rig = new Rig();
        var result = Inspect(rig, true);
        Assert.Empty(result["nodes"]!.AsArray());
        Assert.Null(result["app"]);
    }

    private sealed class Source(IInspectable window) : IInspectSource
    {
        public (FrontAppInfo App, IInspectable Window)? Target() => (new FrontAppInfo("a.exe", "A", 1), window);
    }

    private static FakeWorld.Reader.Node Tree(int depth, int width) => new("Pane", null,
        depth == 0 ? Array.Empty<FakeWorld.Reader.Node>() : Enumerable.Range(0, width).Select(_ => Tree(depth - 1, width)).ToArray());

    [Theory]
    [InlineData(8, 1, 7)]
    [InlineData(3, 12, 500)]
    public void StopsAtSixDeepAndFiveHundredRows(int depth, int width, int rows)
    {
        var result = new InspectController(new Source(Tree(depth, width))).Inspect(new JsonObject { ["showValues"] = false });
        Assert.Equal(rows, result["nodes"]!.AsArray().Count);
        Assert.True(result["truncated"]!.GetValue<bool>());
    }
}

public class SiteTests
{
    [Theory]
    [InlineData("https://www.Example.com/a%20b?q=secret#part", "www.example.com", "/a b")]
    [InlineData("http://example.com", "example.com", "/")]
    public void KeepsTheHostAndPathOnly(string address, string host, string path) =>
        Assert.Equal(new SiteInfo(host, path), SiteInfo.From(address));

    [Theory]
    [InlineData("chrome://settings")]
    [InlineData("file:///C:/x")]
    [InlineData("example.com/typed")]
    public void IgnoresWhatIsNotAWebPage(string address) => Assert.Null(SiteInfo.From(address));

    private static JsonObject Last(Rig rig) => rig.Events.Last(e => e.Type == "focus.app").Payload;

    [Fact]
    public void ReportsABrowserPageAndItsChanges()
    {
        using var rig = new Rig();
        rig.World.ReaderState.Address = "https://example.com/one";
        rig.Call("focus.watch", new JsonObject { ["enabled"] = true });
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "chrome.exe", ["name"] = "Chrome" });
        Assert.Equal("ok", Last(rig)["siteStatus"]!.GetValue<string>());
        Assert.Equal("/one", Last(rig)["site"]!["path"]!.GetValue<string>());
        rig.World.ReaderState.Address = null;
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "chrome.exe", ["name"] = "Chrome" });
        Assert.Equal("unavailable", Last(rig)["siteStatus"]!.GetValue<string>());
    }

    [Fact]
    public void ReadsNoPageOutsideABrowser()
    {
        using var rig = new Rig();
        rig.World.ReaderState.Address = "https://example.com/";
        rig.Call("focus.watch", new JsonObject { ["enabled"] = true });
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "notepad.exe", ["name"] = "Notepad" });
        Assert.Equal("none", Last(rig)["siteStatus"]!.GetValue<string>());
        Assert.Null(Last(rig)["site"]);
    }
}
