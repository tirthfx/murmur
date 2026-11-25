using System.Text.Json.Nodes;
using Xunit;

namespace Murmur.Helper.Tests;

public class EnvelopeTests
{
    [Fact]
    public void RoundTripsARequest()
    {
        var line = new Envelope("m-000001", "ping", new JsonObject()).Encode();
        var decoded = Assert.IsType<Decoded.Ok>(EnvelopeCodec.Decode(line));
        Assert.Equal("m-000001", decoded.Envelope.Id);
        Assert.Equal("ping", decoded.Envelope.Type);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("")]
    public void ReportsMalformedJson(string line) => Assert.IsType<Decoded.Malformed>(EnvelopeCodec.Decode(line));

    [Theory]
    [InlineData("[]")]
    [InlineData("{\"id\":\"a\",\"type\":\"x\"}")]
    [InlineData("{\"id\":\"a\",\"type\":\"x\",\"payload\":{},\"extra\":1}")]
    [InlineData("{\"id\":1,\"type\":\"x\",\"payload\":{}}")]
    [InlineData("{\"id\":\"a\",\"type\":\"\",\"payload\":{}}")]
    public void RefusesWhatIsNotAnEnvelope(string line) => Assert.IsType<Decoded.Invalid>(EnvelopeCodec.Decode(line));

    [Fact]
    public void KeepsTheIdOfAnInvalidRequestSoItCanBeAnswered()
    {
        var invalid = Assert.IsType<Decoded.Invalid>(EnvelopeCodec.Decode("{\"id\":\"m-000009\",\"type\":\"x\",\"payload\":5}"));
        Assert.Equal("m-000009", invalid.Id);
    }
}

public class RouterTests
{
    [Fact]
    public void SaysHelloWithTheProtocolVersionAndWhatItCanDo()
    {
        using var rig = new Rig(handshake: false);
        var hello = rig.Router.HelloEvent();
        Assert.Null(hello.Id);
        Assert.Equal("hello", hello.Type);
        Assert.Equal(ProtocolConstants.ProtocolVersion, hello.Payload["protocolVersion"]!.GetValue<int>());
        var caps = hello.Payload["capabilities"]!.AsArray().Select(c => c!.GetValue<string>()).ToList();
        Assert.Contains("meeting.capture", caps);
        Assert.Contains("keychain", caps);
        Assert.Contains("transcribe.file", caps);
        Assert.Contains("transcribe.live", caps);
        Assert.DoesNotContain("transcribe.whisperkit", caps);
    }

    [Fact]
    public void RefusesRequestsBeforeTheHandshake()
    {
        using var rig = new Rig(handshake: false);
        Assert.Equal(ErrorCode.HandshakeRequired, Rig.Error(rig.Send("ping")));
        rig.Ack();
        Assert.True(rig.Call("ping")["uptimeMs"]!.GetValue<long>() >= 0);
    }

    [Fact]
    public void RefusesAnotherProtocolVersion()
    {
        using var rig = new Rig(handshake: false);
        Assert.Equal(ErrorCode.ProtocolVersionMismatch,
            Rig.Error(rig.Send("hello.ack", new JsonObject { ["accepted"] = true, ["protocolVersion"] = 99, ["appVersion"] = "1" })));
        Assert.Equal(ErrorCode.HandshakeRequired, Rig.Error(rig.Send("ping")));
    }

    [Fact]
    public void AnUnknownRequestIsUnsupportedAndAnUnreadableOneIsInvalid()
    {
        using var rig = new Rig();
        Assert.Equal(ErrorCode.UnsupportedRequest, Rig.Error(rig.Send("selection.read", new JsonObject())));
        Assert.Equal(ErrorCode.InvalidPayload, Rig.Error(rig.Send("keychain.get", new JsonObject { ["service"] = 5 })));
        var bad = rig.Router.Handle("nonsense").Single();
        Assert.Equal("helper.error", bad.Type);
        Assert.Equal(ErrorCode.InvalidPayload, bad.Payload["code"]!.GetValue<string>());
    }

    [Fact]
    public void ReportsEveryPermissionAndRequestsOne()
    {
        using var rig = new Rig();
        var status = rig.Call("permissions.status");
        foreach (var kind in Router.PermissionKinds) Assert.NotNull(status[kind]);
        Assert.Equal("not_determined", status["microphone"]!.GetValue<string>());
        var asked = rig.Call("permissions.request", new JsonObject { ["kind"] = "microphone" });
        Assert.Equal("granted", asked["status"]!.GetValue<string>());
        Assert.Equal(ErrorCode.InvalidPayload, Rig.Error(rig.Send("permissions.request", new JsonObject { ["kind"] = "screenRecording" })));
    }

    [Fact]
    public void KeepsSecretsByServiceAndAccount()
    {
        using var rig = new Rig();
        Assert.False(rig.Call("keychain.get", Key("a", "b"))["found"]!.GetValue<bool>());
        var set = Key("a", "b"); set["value"] = "s3cret";
        rig.Call("keychain.set", set);
        var got = rig.Call("keychain.get", Key("a", "b"));
        Assert.True(got["found"]!.GetValue<bool>());
        Assert.Equal("s3cret", got["value"]!.GetValue<string>());
        Assert.False(rig.Call("keychain.get", Key("a", "c"))["found"]!.GetValue<bool>());
        Assert.True(rig.Call("keychain.delete", Key("a", "b"))["deleted"]!.GetValue<bool>());
        Assert.False(rig.Call("keychain.delete", Key("a", "b"))["deleted"]!.GetValue<bool>());
    }

    private static JsonObject Key(string service, string account) => new() { ["service"] = service, ["account"] = account };

    [Fact]
    public void ShutdownAnswersAndThenTheHostMayExit()
    {
        using var rig = new Rig();
        Assert.False(rig.Router.ShouldExit);
        rig.Call("shutdown", new JsonObject { ["reason"] = "test" });
        Assert.True(rig.Router.ShouldExit);
    }

    [Fact]
    public void MutesTheOutputAndSaysWhatItWas()
    {
        using var rig = new Rig();
        Assert.False(rig.Call("media.status")["outputMuted"]!.GetValue<bool>());
        Assert.False(rig.Call("media.mute", new JsonObject { ["muted"] = true })["previousMuted"]!.GetValue<bool>());
        Assert.True(rig.Call("media.mute", new JsonObject { ["muted"] = false })["previousMuted"]!.GetValue<bool>());
    }
}
