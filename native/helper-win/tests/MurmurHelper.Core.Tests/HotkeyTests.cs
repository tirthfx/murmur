using System.Text.Json.Nodes;
using Xunit;

namespace Murmur.Helper.Tests;

public class HotkeyTests
{
    private const int F11 = 0x7A, Space = 0x20, KeyA = 0x41, KeyB = 0x42;

    private static HotkeyBinding Bind(string id, int key, string mode = "hold", string[]? mods = null, bool exclusive = false, string action = "dictate.hold") =>
        new(id, action, "key", key, mods ?? Array.Empty<string>(), mode, null, exclusive);

    private static (HotkeyEngine Engine, List<(string Id, string State)> Events, List<bool> Listening) Make()
    {
        var events = new List<(string, string)>();
        var listening = new List<bool>();
        var engine = new HotkeyEngine((_, p) => events.Add((p["bindingId"]!.GetValue<string>(), p["state"]!.GetValue<string>())), () => 5, listening.Add);
        return (engine, events, listening);
    }

    [Fact]
    public void AHoldBindingSaysDownThenUp()
    {
        var (engine, events, _) = Make();
        engine.Configure(new[] { Bind("d", F11) });
        engine.OnKey(F11, true);
        engine.OnKey(F11, true); // key repeat is ignored
        engine.OnKey(F11, false);
        Assert.Equal(new[] { ("d", "down"), ("d", "up") }, events);
    }

    [Fact]
    public void ModifiersMustMatchExactlyAndLeftAndRightAreOneKey()
    {
        var (engine, events, _) = Make();
        engine.Configure(new[] { Bind("d", Space, mods: new[] { "control" }) });
        engine.OnKey(Space, true); engine.OnKey(Space, false);
        Assert.Empty(events); // no modifier
        engine.OnKey(0xA3, true); // right control
        engine.OnKey(Space, true);
        engine.OnKey(Space, false);
        engine.OnKey(0xA3, false);
        Assert.Equal(new[] { ("d", "down"), ("d", "up") }, events);
        events.Clear();
        engine.OnKey(0x11, true); engine.OnKey(0x10, true); // control and shift: not the binding
        engine.OnKey(Space, true); engine.OnKey(Space, false);
        Assert.Empty(events);
    }

    [Fact]
    public void ReleasingAModifierEndsAHold()
    {
        var (engine, events, _) = Make();
        engine.Configure(new[] { Bind("d", Space, mods: new[] { "control" }) });
        engine.OnKey(0x11, true); engine.OnKey(Space, true);
        engine.OnKey(0x11, false);
        Assert.Equal(new[] { ("d", "down"), ("d", "up") }, events);
        engine.OnKey(Space, false);
        Assert.Equal(2, events.Count);
    }

    [Fact]
    public void AnExclusiveHoldIsInterruptedByAnotherKeyAndThenSaysNoUp()
    {
        var (engine, events, _) = Make();
        engine.Configure(new[] { Bind("d", F11, exclusive: true) });
        engine.OnKey(F11, true);
        engine.OnKey(KeyA, true);
        engine.OnKey(F11, false);
        Assert.Equal(new[] { ("d", "down"), ("d", "interrupted") }, events);
    }

    [Fact]
    public void PressAndToggleBindingsSayPressOnce()
    {
        var (engine, events, _) = Make();
        engine.Configure(new[] { Bind("p", KeyA, "press"), Bind("t", KeyB, "toggle") });
        engine.OnKey(KeyA, true); engine.OnKey(KeyA, true); engine.OnKey(KeyA, false);
        engine.OnKey(KeyB, true); engine.OnKey(KeyB, false);
        Assert.Equal(new[] { ("p", "press"), ("t", "press") }, events);
    }

    [Fact]
    public void ListensOnlyWhileABindingIsSetAndRejectsWhatItCannotDo()
    {
        var (engine, _, listening) = Make();
        var result = engine.Configure(new[]
        {
            Bind("ok", F11),
            Bind("ok", KeyA),
            Bind("fn", KeyA, mods: new[] { "fn" }),
            new HotkeyBinding("mouse", "dictate.hold", "mouse", 9, Array.Empty<string>(), "hold", null, false),
            Bind("high", 300),
            Bind("rw", KeyB, action: "rewrite"),
            Bind("ex", KeyB, "press", exclusive: true),
        });
        Assert.Equal(new[] { "ok" }, result.Registered);
        Assert.Equal(
            new[] { "DUPLICATE_ID", "UNSUPPORTED_MODIFIER", "UNSUPPORTED_TRIGGER", "UNSUPPORTED_KEY", "INVALID_BINDING", "INVALID_BINDING" },
            result.Rejected.Select(r => r.Code));
        engine.Configure(Array.Empty<HotkeyBinding>());
        Assert.Equal(new[] { true, false }, listening);
    }

    [Fact]
    public void ARewriteBindingCarriesItsRewriteId()
    {
        var events = new List<JsonObject>();
        var engine = new HotkeyEngine((_, p) => events.Add(p), () => 1);
        engine.Configure(new[] { new HotkeyBinding("r", "rewrite", "key", KeyA, Array.Empty<string>(), "press", "rw-1", false) });
        engine.OnKey(KeyA, true);
        Assert.Equal("rw-1", events.Single()["rewriteId"]!.GetValue<string>());
    }

    [Fact]
    public void ParsesABindingFromARequest()
    {
        var json = JsonNode.Parse("""{"id":"d","action":"dictate.hold","trigger":{"type":"key","keyCode":122,"modifiers":["shift"]},"mode":"hold","exclusive":true}""")!.AsObject();
        var binding = HotkeyBinding.Parse(json);
        Assert.Equal(122, binding.KeyCode);
        Assert.Equal(new[] { "shift" }, binding.Modifiers);
        Assert.True(binding.Exclusive);
    }

    [Fact]
    public void ARightHandModifierBindingIgnoresTheLeftOne()
    {
        var (engine, events, _) = Make();
        engine.Configure(new[] { Bind("d", 0xA3) }); // Right Ctrl
        engine.OnKey(0xA2, true); engine.OnKey(0xA2, false);
        Assert.Empty(events);
        engine.OnKey(0xA3, true); engine.OnKey(0xA3, true); engine.OnKey(0xA3, false);
        Assert.Equal(new[] { ("d", "down"), ("d", "up") }, events);
    }

    [Fact]
    public void EitherSideModifierHoldsUntilBothAreLetGo()
    {
        var (engine, events, _) = Make();
        engine.Configure(new[] { Bind("d", Space, mods: new[] { "control" }) });
        engine.OnKey(0xA2, true); engine.OnKey(0xA3, true); engine.OnKey(Space, true);
        engine.OnKey(0xA2, false);
        Assert.Equal(new[] { ("d", "down") }, events);
        engine.OnKey(0xA3, false);
        Assert.Equal(new[] { ("d", "down"), ("d", "up") }, events);
    }

    private static HotkeyBinding Mouse(string id, int button, string mode = "hold", bool exclusive = false) =>
        new(id, "dictate.hold", "mouse", button, Array.Empty<string>(), mode, null, exclusive);

    [Fact]
    public void AMouseHoldBindingSaysDownThenUpAndIgnoresRepeats()
    {
        var (engine, events, _) = Make();
        engine.Configure(new[] { Mouse("m", HotkeyEngine.MouseBack) });
        engine.OnMouse(HotkeyEngine.MouseBack, true);
        engine.OnMouse(HotkeyEngine.MouseBack, true);
        engine.OnMouse(HotkeyEngine.MouseBack, false);
        engine.OnMouse(HotkeyEngine.MouseBack, false);
        Assert.Equal(new[] { ("m", "down"), ("m", "up") }, events);
    }

    [Fact]
    public void AMousePressBindingFiresOnTheButtonGoingDownOnly()
    {
        var (engine, events, _) = Make();
        engine.Configure(new[] { Mouse("m", HotkeyEngine.MouseMiddle, "press") });
        engine.OnMouse(HotkeyEngine.MouseMiddle, true);
        engine.OnMouse(HotkeyEngine.MouseMiddle, false);
        Assert.Equal(new[] { ("m", "press") }, events);
    }

    [Fact]
    public void OnlyTheBoundButtonCounts()
    {
        var (engine, events, _) = Make();
        engine.Configure(new[] { Mouse("m", HotkeyEngine.MouseBack) });
        engine.OnMouse(HotkeyEngine.MouseForward, true);
        engine.OnMouse(HotkeyEngine.MouseForward, false);
        Assert.Empty(events);
    }

    [Fact]
    public void AMouseButtonAndAKeyWithTheSameNumberAreNotMixedUp()
    {
        var (engine, events, _) = Make();
        // Virtual key 3 is Cancel and button 3 is Back: neither may trigger the other's binding.
        engine.Configure(new[] { Mouse("m", HotkeyEngine.MouseBack), Bind("k", 3, "press") });
        engine.OnKey(3, true); engine.OnKey(3, false);
        Assert.Equal(new[] { ("k", "press") }, events);
        events.Clear();
        engine.OnMouse(HotkeyEngine.MouseBack, true); engine.OnMouse(HotkeyEngine.MouseBack, false);
        Assert.Equal(new[] { ("m", "down"), ("m", "up") }, events);
    }

    [Fact]
    public void AKeyDoesNotInterruptAMouseHold()
    {
        var (engine, events, _) = Make();
        engine.Configure(new[] { Mouse("m", HotkeyEngine.MouseMiddle) });
        engine.OnMouse(HotkeyEngine.MouseMiddle, true);
        engine.OnKey(KeyA, true); engine.OnKey(KeyA, false);
        engine.OnMouse(HotkeyEngine.MouseMiddle, false);
        Assert.Equal(new[] { ("m", "down"), ("m", "up") }, events);
    }

    [Fact]
    public void MouseButtonsWindowsDoesNotReportAndExclusiveMouseBindingsAreRejected()
    {
        var (engine, _, _) = Make();
        var result = engine.Configure(new[] { Mouse("ok", HotkeyEngine.MouseForward), Mouse("many", 9), Mouse("left", 0), Mouse("ex", HotkeyEngine.MouseMiddle, exclusive: true) });
        Assert.Equal(new[] { "ok" }, result.Registered);
        Assert.Equal(new[] { "UNSUPPORTED_TRIGGER", "UNSUPPORTED_TRIGGER", "INVALID_BINDING" }, result.Rejected.Select(r => r.Code));
    }

    [Fact]
    public void ReconfiguringLetsGoOfAHeldMouseButton()
    {
        var (engine, events, _) = Make();
        engine.Configure(new[] { Mouse("m", HotkeyEngine.MouseBack) });
        engine.OnMouse(HotkeyEngine.MouseBack, true);
        engine.Configure(new[] { Mouse("m", HotkeyEngine.MouseBack) });
        engine.OnMouse(HotkeyEngine.MouseBack, true); // down again after the reset
        Assert.Equal(new[] { ("m", "down"), ("m", "down") }, events);
    }

    [Fact]
    public void XButtonNumbersFollowTheProtocol()
    {
        Assert.Equal(HotkeyEngine.MouseBack, HotkeyEngine.XButton(1u << 16));
        Assert.Equal(HotkeyEngine.MouseForward, HotkeyEngine.XButton(2u << 16));
        Assert.Equal(0, HotkeyEngine.XButton(3u << 16));
    }
}
