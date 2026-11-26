using Xunit;
using System.Text.Json.Nodes;

namespace Murmur.Helper.Tests;

/// <summary>A router on the fake OS with its events collected, for tests.</summary>
public sealed class Rig : IDisposable
{
    public readonly List<(string Type, JsonObject Payload)> Events = new();
    public readonly FakeWorld World;
    public readonly Router Router;
    public readonly string Folder = Path.Combine(Path.GetTempPath(), "murmur-helper-tests-" + Guid.NewGuid().ToString("N"));
    private int _counter;
    private long _now = 1_000;

    public Rig(bool handshake = true)
    {
        World = new FakeWorld((type, payload) => Events.Add((type, payload)), () => _now++);
        var backends = World.Backends();
        EventSink sink = (type, payload) => Events.Add((type, payload));
        var mic = new MicSession(backends.Audio!, backends.Permissions, sink, () => _now++, Path.Combine(Folder, "audio"));
        var meeting = new MeetingCapture(backends.Audio!, backends.Permissions, sink, () => _now++);
        Router = new Router(backends, mic, meeting, sink);
        if (handshake) Ack();
    }

    public JsonObject Ack(int version = ProtocolConstants.ProtocolVersion, bool accepted = true) =>
        Ok(Send("hello.ack", new JsonObject { ["accepted"] = accepted, ["protocolVersion"] = version, ["appVersion"] = "1.0.0" }));

    public Envelope Send(string type, JsonObject? payload = null)
    {
        var id = $"m-{++_counter:D6}";
        var line = new Envelope(id, type, payload ?? new JsonObject()).Encode();
        return Router.Handle(line).Single();
    }

    public static JsonObject Ok(Envelope response)
    {
        Assert.Equal("response", response.Type);
        Assert.True(response.Payload["ok"]!.GetValue<bool>(), response.Payload.ToJsonString());
        return response.Payload["result"]!.AsObject();
    }

    public static string Error(Envelope response)
    {
        Assert.False(response.Payload["ok"]!.GetValue<bool>(), response.Payload.ToJsonString());
        return response.Payload["error"]!["code"]!.GetValue<string>();
    }

    public JsonObject Call(string type, JsonObject? payload = null) => Ok(Send(type, payload));

    public void Act(JsonObject op) => Call("test.world", op);

    public void Dispose()
    {
        try { Directory.Delete(Folder, recursive: true); } catch { /* not made */ }
    }
}
