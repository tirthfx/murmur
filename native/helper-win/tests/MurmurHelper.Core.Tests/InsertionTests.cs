using System.Text.Json.Nodes;
using Xunit;

namespace Murmur.Helper.Tests;

public class InsertionTests
{
    private static JsonObject Request(string text, string method = "auto", bool restore = true, bool enter = false, string[]? typeIn = null, string[]? trim = null, string? html = null)
    {
        var p = new JsonObject
        {
            ["text"] = text, ["method"] = method, ["restoreClipboard"] = restore, ["restoreDelayMs"] = 0, ["pressEnter"] = enter,
            ["typeInApps"] = new JsonArray((typeIn ?? Array.Empty<string>()).Select(a => (JsonNode?)JsonValue.Create(a)).ToArray()),
            ["trimTrailingNewlinesInApps"] = new JsonArray((trim ?? Array.Empty<string>()).Select(a => (JsonNode?)JsonValue.Create(a)).ToArray()),
        };
        if (html is not null) p["html"] = html;
        return p;
    }

    [Fact]
    public void PastesIntoTheFocusedFieldAndSaysTheClipboardWasRestored()
    {
        using var rig = new Rig();
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "notepad.exe", ["name"] = "Notepad" });
        var done = rig.Call("insert.text", Request("Hello"));
        Assert.Equal("Hello", rig.World.Field);
        Assert.Equal("paste_cmd_v", done["method"]!.GetValue<string>());
        Assert.True(done["clipboardRestored"]!.GetValue<bool>());
        Assert.Equal("notepad.exe", done["appBundleId"]!.GetValue<string>());
    }

    [Fact]
    public void TypesInTheAppsThatAskForItAndLeavesTheClipboardAlone()
    {
        using var rig = new Rig();
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "mstsc.exe", ["name"] = "Remote" });
        var done = rig.Call("insert.text", Request("abc", typeIn: new[] { "MSTSC.exe" }));
        Assert.Equal("keystrokes", done["method"]!.GetValue<string>());
        Assert.Null(done["clipboardRestored"]);
        Assert.Equal("keystrokes", rig.Call("insert.text", Request("x", method: "keystrokes"))["method"]!.GetValue<string>());
    }

    [Fact]
    public void TrimsTrailingNewlinesOnlyWhereAsked()
    {
        using var rig = new Rig();
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "cmd.exe", ["name"] = "Terminal" });
        rig.Call("insert.text", Request("ls\n\n", trim: new[] { "cmd.exe" }));
        Assert.Equal("ls", rig.World.Field);
        rig.Act(new JsonObject { ["op"] = "focusTextField" });
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "notepad.exe", ["name"] = "Notepad" });
        rig.Call("insert.text", Request("a\n", trim: new[] { "cmd.exe" }));
        Assert.Equal("a\n", rig.World.Field);
    }

    [Fact]
    public void PressesReturnOnlyIfTheSameAppIsStillInFront()
    {
        using var rig = new Rig();
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "a.exe", ["name"] = "A" });
        var done = rig.Call("insert.text", Request("hi", enter: true));
        Assert.True(done["enterPressed"]!.GetValue<bool>());
        Assert.Equal("hi\n", rig.World.Field);
        var none = rig.Call("insert.text", Request("x"));
        Assert.Null(none["enterPressed"]);
    }

    [Fact]
    public void RefusesAnUnknownMethodAndCopiesText()
    {
        using var rig = new Rig();
        Assert.Equal(ErrorCode.InvalidPayload, Rig.Error(rig.Send("insert.text", Request("x", method: "magic"))));
        rig.Call("insert.copy", new JsonObject { ["text"] = "copied" });
        Assert.Equal("copied", rig.World.InsertionState.Clipboard);
    }

    [Fact]
    public void BuildsTheHtmlClipboardFormatWithCorrectOffsets()
    {
        var text = CfHtml.Build("<b>héllo</b>");
        var bytes = System.Text.Encoding.UTF8.GetBytes(text);
        int Field(string name)
        {
            var at = text.IndexOf(name + ":", StringComparison.Ordinal) + name.Length + 1;
            return int.Parse(text.AsSpan(at, 10));
        }
        Assert.Equal(bytes.Length, Field("EndHTML"));
        var fragment = System.Text.Encoding.UTF8.GetString(bytes, Field("StartFragment"), Field("EndFragment") - Field("StartFragment"));
        Assert.Equal("<b>héllo</b>", fragment);
        Assert.StartsWith("<html>", System.Text.Encoding.UTF8.GetString(bytes, Field("StartHTML"), 6));
    }
}
