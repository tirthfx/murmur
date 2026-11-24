using System.Text;
using System.Text.Json.Nodes;
using Xunit;

namespace Murmur.Helper.Tests;

public class HostTests
{
    private static (string[] Lines, Router Router) Run(string input, Func<Host, Router>? build = null)
    {
        var output = new MemoryStream();
        var host = new Host(new MemoryStream(Encoding.UTF8.GetBytes(input)), output);
        var world = new FakeWorld(host.Emit, () => 1);
        var backends = world.Backends();
        EventSink sink = host.Emit;
        var router = new Router(backends,
            new MicSession(backends.Audio!, backends.Permissions, sink, () => 1, Path.GetTempPath()),
            new MeetingCapture(backends.Audio!, backends.Permissions, sink, () => 1));
        host.Run(router);
        var lines = Encoding.UTF8.GetString(output.ToArray()).Split('\n', StringSplitOptions.RemoveEmptyEntries);
        return (lines, router);
    }

    private static string Request(string id, string type, string payload = "{}") => $"{{\"id\":\"{id}\",\"type\":\"{type}\",\"payload\":{payload}}}\n";

    [Fact]
    public void SaysHelloFirstThenAnswersEachLineAndStopsAfterShutdown()
    {
        var input = Request("m-000001", "hello.ack", "{\"accepted\":true,\"protocolVersion\":1,\"appVersion\":\"1\"}")
            + Request("m-000002", "ping")
            + Request("m-000003", "shutdown", "{\"reason\":\"x\"}")
            + Request("m-000004", "ping"); // after shutdown: never answered
        var (lines, router) = Run(input);
        Assert.Equal(4, lines.Length);
        Assert.Equal("hello", JsonNode.Parse(lines[0])!["type"]!.GetValue<string>());
        Assert.Equal("m-000002", JsonNode.Parse(lines[2])!["id"]!.GetValue<string>());
        Assert.Equal("m-000003", JsonNode.Parse(lines[3])!["id"]!.GetValue<string>());
        Assert.True(router.ShouldExit);
    }

    [Fact]
    public void AnswersAnUnreadableLineAndKeepsGoing()
    {
        var (lines, _) = Run("garbage\n" + Request("m-000001", "ping"));
        Assert.Equal("helper.error", JsonNode.Parse(lines[1])!["type"]!.GetValue<string>());
        Assert.Equal("HANDSHAKE_REQUIRED", JsonNode.Parse(lines[2])!["payload"]!["error"]!["code"]!.GetValue<string>());
    }

    [Fact]
    public void DropsAnOversizedLineWithAnErrorAndReadsTheNextOne()
    {
        var big = new string('x', ProtocolConstants.MaxLineBytes + 10);
        var (lines, _) = Run(big + "\n" + Request("m-000001", "ping"));
        Assert.Equal("helper.error", JsonNode.Parse(lines[1])!["type"]!.GetValue<string>());
        Assert.Contains("exceeds", JsonNode.Parse(lines[1])!["payload"]!["message"]!.GetValue<string>());
        Assert.Equal("m-000001", JsonNode.Parse(lines[2])!["id"]!.GetValue<string>());
    }

    [Fact]
    public void WritesEventsBeforeTheResponseThatCausedThem()
    {
        var input = Request("m-000001", "hello.ack", "{\"accepted\":true,\"protocolVersion\":1,\"appVersion\":\"1\"}")
            + Request("m-000002", "permissions.request", "{\"kind\":\"microphone\"}")
            + Request("m-000003", "audio.start", "{\"sessionId\":\"s\",\"emitLevels\":true,\"levelIntervalMs\":500}");
        var (lines, _) = Run(input);
        var types = lines.Select(l => JsonNode.Parse(l)!["type"]!.GetValue<string>()).ToList();
        var levels = types.Count(t => t == "audio.level");
        Assert.Equal(2, levels);
        Assert.Equal("response", types[^1]);
        Assert.True(types.IndexOf("audio.level") < types.LastIndexOf("response"));
    }
}
