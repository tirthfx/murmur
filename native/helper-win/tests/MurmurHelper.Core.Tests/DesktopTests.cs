using System.Text.Json.Nodes;
using Xunit;

namespace Murmur.Helper.Tests;

public class SelectionTests
{
    private static (Rig Rig, FakeWorld.Desktop Desktop) Make()
    {
        var rig = new Rig();
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "notepad.exe", ["name"] = "Notepad" });
        return (rig, rig.World.DesktopState);
    }

    private static string Status(JsonObject result) => result["status"]!.GetValue<string>();
    private static string Text(JsonObject result) => result["text"]!.GetValue<string>();

    [Fact]
    public void ReportsTheSelectionWithItsRangeAndHash()
    {
        var (rig, desktop) = Make();
        using var _ = rig;
        desktop.Reads = new FocusedSelection(SelectionKind.Selected, "hello", 4, 5);
        var result = rig.Call("selection.read");
        Assert.Equal("ok", Status(result));
        Assert.Equal("hello", Text(result));
        Assert.Equal("ax", result["source"]!.GetValue<string>());
        Assert.Equal("notepad.exe", result["appBundleId"]!.GetValue<string>());
        Assert.Equal(4, result["range"]!["location"]!.GetValue<int>());
        Assert.Equal("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", result["hash"]!.GetValue<string>());
        Assert.Equal(0, desktop.CopyPresses);
    }

    [Fact]
    public void CountsAWindowsLineEndAsOneCharacter()
    {
        var (rig, desktop) = Make();
        using var _ = rig;
        desktop.Reads = new FocusedSelection(SelectionKind.Selected, "a\r\nb", 0, 4);
        var result = rig.Call("selection.read");
        Assert.Equal("a\nb", Text(result));
        Assert.Equal(3, result["length"]!.GetValue<int>());
    }

    [Fact]
    public void AnEmptySelectionIsNotCopied()
    {
        var (rig, desktop) = Make();
        using var _ = rig;
        var result = rig.Call("selection.read");
        Assert.Equal("empty", Status(result));
        Assert.Equal("", result["hash"]!.GetValue<string>());
        Assert.Null(result["source"]);
        Assert.Equal(0, desktop.CopyPresses);
    }

    [Fact]
    public void APasswordFieldIsNeverCopiedEvenForCopyFirstApps()
    {
        var (rig, desktop) = Make();
        using var _ = rig;
        desktop.Reads = new FocusedSelection(SelectionKind.Secure);
        desktop.Copies = "hunter2";
        var result = rig.Call("selection.read", new JsonObject { ["clipboardFirstInApps"] = new JsonArray("NOTEPAD.EXE") });
        Assert.Equal("secure", Status(result));
        Assert.Equal("", Text(result));
        Assert.Equal(0, desktop.CopyPresses);
    }

    [Fact]
    public void CopiesWhenTheElementDoesNotSayAndPutsTheClipboardBack()
    {
        var (rig, desktop) = Make();
        using var _ = rig;
        desktop.Reads = new FocusedSelection(SelectionKind.Unsupported);
        desktop.Copies = "copied\r\ntext";
        var result = rig.Call("selection.read");
        Assert.Equal("ok", Status(result));
        Assert.Equal("copied\ntext", Text(result));
        Assert.Equal("clipboard", result["source"]!.GetValue<string>());
        Assert.Null(result["range"]);
        Assert.Equal("before", desktop.ClipboardText);
        Assert.Equal(1, desktop.Restores);
    }

    [Fact]
    public void NothingCopiedMeansNothingSelected()
    {
        var (rig, desktop) = Make();
        using var _ = rig;
        desktop.Reads = new FocusedSelection(SelectionKind.NoFocus);
        var result = rig.Call("selection.read", new JsonObject { ["copyWaitMs"] = 50 });
        Assert.Equal("empty", Status(result));
        Assert.Equal("before", desktop.ClipboardText);
        Assert.Equal(0, desktop.Restores);
    }

    [Fact]
    public void DoesNotCopyOverAClipboardItCannotSave()
    {
        var (rig, desktop) = Make();
        using var _ = rig;
        desktop.Reads = new FocusedSelection(SelectionKind.Unsupported);
        desktop.Copies = "x";
        desktop.SaveFails = true;
        Assert.Equal("unavailable", Status(rig.Call("selection.read")));
        Assert.Equal(0, desktop.CopyPresses);
    }

    [Fact]
    public void WithoutTheFallbackAnUnreadableFieldIsUnavailable()
    {
        var (rig, desktop) = Make();
        using var _ = rig;
        desktop.Reads = new FocusedSelection(SelectionKind.Unsupported);
        Assert.Equal("unavailable", Status(rig.Call("selection.read", new JsonObject { ["clipboardFallback"] = false })));
        Assert.Equal(0, desktop.CopyPresses);
    }

    [Fact]
    public void SaysHowLongATooLongSelectionIsWithoutSendingIt()
    {
        var (rig, desktop) = Make();
        using var _ = rig;
        desktop.Reads = new FocusedSelection(SelectionKind.Selected, null, 0, 9000);
        var result = rig.Call("selection.read");
        Assert.Equal("too_long", Status(result));
        Assert.Equal(9000, result["length"]!.GetValue<int>());
        Assert.Equal("", Text(result));
    }

    [Theory]
    [InlineData(49)]
    [InlineData(1001)]
    public void RefusesACopyWaitOutOfRange(int wait)
    {
        var (rig, _) = Make();
        using var __ = rig;
        Assert.Equal(ErrorCode.InvalidPayload, Rig.Error(rig.Send("selection.read", new JsonObject { ["copyWaitMs"] = wait })));
    }

    [Fact]
    public void ASecondReadWhileOneRunsIsBusy()
    {
        var world = new FakeWorld((_, _) => { }, () => 0);
        world.DesktopState.Reads = new FocusedSelection(SelectionKind.Unsupported);
        SelectionController? controller = null;
        string? code = null;
        controller = new SelectionController(world.DesktopState, _ =>
        {
            code ??= Assert.Throws<HelperException>(() => controller!.Read(new JsonObject())).Code;
        });
        controller.Read(new JsonObject { ["copyWaitMs"] = 50 });
        Assert.Equal(ErrorCode.Busy, code);
        Assert.Equal("empty", Status(controller.Read(new JsonObject { ["copyWaitMs"] = 50 })));
    }
}

public class KeysTests
{
    private static JsonObject Press(string key, params string[] modifiers) => new()
    {
        ["key"] = key,
        ["modifiers"] = new JsonArray(modifiers.Select(m => (JsonNode?)JsonValue.Create(m)).ToArray()),
    };

    [Theory]
    [InlineData("b", "command", 'B', true, false, false)]
    [InlineData("a", "command", 'A', true, false, false)]
    [InlineData("z", "command", 'Z', true, false, false)]
    [InlineData("z", "command,shift", 'Y', true, false, false)]
    [InlineData("left_bracket", "command", KeyCombos.Left, false, false, true)]
    [InlineData("return", "shift", KeyCombos.Return, false, true, false)]
    [InlineData("delete", "", KeyCombos.Back, false, false, false)]
    [InlineData("left", "shift", KeyCombos.Left, false, true, false)]
    [InlineData("right", "", KeyCombos.Right, false, false, false)]
    [InlineData("left", "command", KeyCombos.Home, false, false, false)]
    [InlineData("down", "command,shift", KeyCombos.End, true, true, false)]
    [InlineData("left", "option,shift", KeyCombos.Left, true, true, false)]
    public void TranslatesToTheWindowsShortcut(string key, string modifiers, int vk, bool control, bool shift, bool alt)
    {
        using var rig = new Rig();
        var result = rig.Call("keys.press", Press(key, modifiers.Split(',', StringSplitOptions.RemoveEmptyEntries)));
        Assert.True(result["pressed"]!.GetValue<bool>());
        Assert.Equal(new KeyStroke(vk, control, shift, alt), Assert.Single(rig.World.DesktopState.Pressed));
    }

    [Theory]
    [InlineData("v", "command")]
    [InlineData("b", "")]
    [InlineData("b", "command,shift")]
    [InlineData("z", "command,control")]
    [InlineData("delete", "command")]
    [InlineData("left", "control")]
    [InlineData("a", "command,command")]
    [InlineData("a", "hyper")]
    public void RefusesAnythingOffTheList(string key, string modifiers)
    {
        using var rig = new Rig();
        var payload = Press(key, modifiers.Split(',', StringSplitOptions.RemoveEmptyEntries));
        Assert.Equal(ErrorCode.InvalidPayload, Rig.Error(rig.Send("keys.press", payload)));
        Assert.Empty(rig.World.DesktopState.Pressed);
    }

    [Fact]
    public void RepeatsAndRefusesTooManyRepeats()
    {
        using var rig = new Rig();
        var payload = Press("left", "shift");
        payload["repeat"] = 3;
        rig.Call("keys.press", payload);
        Assert.Equal(3, rig.World.DesktopState.Pressed.Count);
        var over = Press("left", "shift");
        over["repeat"] = 201;
        Assert.Equal(ErrorCode.InvalidPayload, Rig.Error(rig.Send("keys.press", over)));
    }

    [Fact]
    public void SendsNothingWhenAnotherAppIsInFront()
    {
        using var rig = new Rig();
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "notepad.exe", ["name"] = "Notepad" });
        var payload = Press("return");
        payload["onlyInApp"] = "chrome.exe";
        var result = rig.Call("keys.press", payload);
        Assert.False(result["pressed"]!.GetValue<bool>());
        Assert.Equal("notepad.exe", result["appBundleId"]!.GetValue<string>());
        Assert.Empty(rig.World.DesktopState.Pressed);
        payload["onlyInApp"] = "Notepad.exe";
        Assert.True(rig.Call("keys.press", payload)["pressed"]!.GetValue<bool>());
    }

    [Fact]
    public void SaysWhenWindowsRefusesTheKeys()
    {
        using var rig = new Rig();
        rig.World.DesktopState.KeysRefused = true;
        Assert.Equal(ErrorCode.PasteFailed, Rig.Error(rig.Send("keys.press", Press("return"))));
    }

    private static string Trace(IReadOnlyList<KeyChange> changes) =>
        string.Join(" ", changes.Select(c => $"{(c.Down ? "+" : "-")}{c.Key:X2}"));

    [Fact]
    public void TypesAShortcutDownAndUp() =>
        Assert.Equal("+11 +41 -41 -11", Trace(KeyCombos.Sequence(new KeyStroke('A', Control: true), Array.Empty<int>())));

    [Fact]
    public void ReleasesHeldKeysWithControlDownSoNoMenuOpens()
    {
        // Right Alt is held (it dictates): Control goes down before Alt comes up.
        Assert.Equal("+11 -A5 -11 +27 -27", Trace(KeyCombos.Sequence(new KeyStroke(KeyCombos.Right), new[] { 0xA5 })));
        // The shortcut has Control already, so no extra press.
        Assert.Equal("+11 -5B +2D -2D -11", Trace(KeyCombos.Sequence(new KeyStroke(KeyCombos.Insert, Control: true), new[] { 0x5B })));
    }

    [Fact]
    public void KeepsAHeldModifierTheShortcutWants() =>
        Assert.Equal("+10 +25 -25 -10", Trace(KeyCombos.Sequence(new KeyStroke(KeyCombos.Left, Shift: true), new[] { 0xA0 })));

    [Fact]
    public void MarksNavigationKeysAsExtended()
    {
        var changes = KeyCombos.Sequence(new KeyStroke(KeyCombos.Left, Shift: true), Array.Empty<int>());
        Assert.True(changes.Single(c => c.Key == KeyCombos.Left && c.Down).Extended);
        Assert.False(changes.First(c => c.Key == KeyCombos.Shift).Extended);
    }
}

public class ProcessTests
{
    private static List<string> Names(JsonObject result) => result["names"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();

    [Fact]
    public void ListsWhatRunsUnderTheFrontAppByNameOnly()
    {
        using var rig = new Rig();
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "WindowsTerminal.exe", ["name"] = "Terminal" });
        Assert.Equal(new[] { "pwsh", "claude" }, Names(rig.Call("proc.foreground")));
    }

    [Fact]
    public void IsEmptyWithNothingInFrontAndSurvivesALoop()
    {
        using var rig = new Rig();
        Assert.Empty(Names(rig.Call("proc.foreground")));
        rig.World.DesktopState.Processes.Add(new ProcessRow(100, 102, "loop.exe"));
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "WindowsTerminal.exe", ["name"] = "Terminal" });
        Assert.Equal(new[] { "pwsh", "claude" }, Names(rig.Call("proc.foreground")));
    }

    [Theory]
    [InlineData("node C:\\npm\\node_modules\\@google\\gemini-cli\\dist\\index.js", "gemini")]
    [InlineData("\"C:\\Program Files\\nodejs\\node.exe\" --no-warnings \"C:\\a b\\node_modules\\@openai\\codex\\bin\\codex.js\" --secret x", "codex")]
    [InlineData("node C:/x/node_modules/opencode-ai/bin/opencode", "opencode")]
    [InlineData("python C:\\Python\\Scripts\\aider-script.py", "aider-script")]
    [InlineData("python C:\\Tools\\Goose.py --token abc", "goose")]
    [InlineData("node", null)]
    [InlineData("node --version", null)]
    public void NamesTheToolAnInterpreterRuns(string commandLine, string? expected) =>
        Assert.Equal(expected, ProcessController.ScriptName(commandLine));
}

public class AppCatalogTests
{
    [Fact]
    public void KeepsOneEntryPerProgramByNameWithoutUninstallers()
    {
        var result = AppCatalog.Result(new[]
        {
            new InstalledApp("zed.exe", "Zed"),
            new InstalledApp("Code.exe", "Visual Studio Code (new window)"),
            new InstalledApp("code.exe", "Visual Studio Code"),
            new InstalledApp("unins000.exe", "Remove Thing"),
            new InstalledApp("setup.exe", "Uninstall Thing"),
            new InstalledApp("readme.txt", "Read me"),
            new InstalledApp("blank.exe", "  "),
        });
        var apps = result["apps"]!.AsArray();
        Assert.Equal(new[] { "code.exe", "zed.exe" }, apps.Select(a => a!["bundleId"]!.GetValue<string>()));
        Assert.Equal("Visual Studio Code", apps[0]!["name"]!.GetValue<string>());
    }

    [Fact]
    public void TheFrontAppIsNamedAfterTheProgramNotItsWindow()
    {
        using var rig = new Rig();
        rig.Call("focus.watch", new JsonObject { ["enabled"] = true });
        rig.Act(new JsonObject { ["op"] = "focusApp", ["bundleId"] = "chrome.exe", ["name"] = "Google Chrome" });
        var last = rig.Events.Last(e => e.Type == "focus.app").Payload;
        Assert.Equal("Google Chrome", last["name"]!.GetValue<string>());
    }
}

public class ActivateTests
{
    [Theory]
    [InlineData("NOTEPAD.EXE", true)]
    [InlineData("missing.exe", false)]
    public void BringsARunningProgramForward(string program, bool activated)
    {
        using var rig = new Rig();
        Assert.Equal(activated, rig.Call("apps.activate", new JsonObject { ["bundleId"] = program })["activated"]!.GetValue<bool>());
        Assert.Equal(ErrorCode.InvalidPayload, Rig.Error(rig.Send("apps.activate")));
    }
}
