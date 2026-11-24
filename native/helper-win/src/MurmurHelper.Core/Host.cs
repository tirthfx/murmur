using System.Text;

namespace Murmur.Helper;

/// <summary>
/// Reads requests from stdin and writes responses and events to stdout, one JSON message per
/// line. Writes from backend threads and the reader are serialised, and a response is written
/// after the events its request caused.
/// </summary>
public sealed class Host
{
    private readonly Stream _input;
    private readonly Stream _output;
    private readonly object _write = new();

    public Host(Stream input, Stream output)
    {
        _input = input;
        _output = output;
    }

    public void Send(Envelope message)
    {
        var bytes = Encoding.UTF8.GetBytes(message.Encode() + "\n");
        lock (_write)
        {
            _output.Write(bytes);
            _output.Flush();
        }
    }

    public void Emit(string type, System.Text.Json.Nodes.JsonObject payload) => Send(new Envelope(null, type, payload));

    /// <summary>Runs until stdin closes or a shutdown was answered.</summary>
    public void Run(Router router)
    {
        Send(router.HelloEvent());
        var line = new MemoryStream();
        var oversized = false;
        var buffer = new byte[16 * 1024];
        int read;
        while ((read = _input.Read(buffer, 0, buffer.Length)) > 0)
        {
            for (var i = 0; i < read; i++)
            {
                var b = buffer[i];
                if (b != (byte)'\n')
                {
                    if (oversized) continue;
                    if (line.Length >= ProtocolConstants.MaxLineBytes)
                    {
                        oversized = true;
                        line.SetLength(0);
                        continue;
                    }
                    line.WriteByte(b);
                    continue;
                }
                if (oversized)
                {
                    oversized = false;
                    Send(Router.OversizedLineError());
                }
                else if (line.Length > 0)
                {
                    var text = Encoding.UTF8.GetString(line.GetBuffer(), 0, (int)line.Length).TrimEnd('\r');
                    foreach (var reply in router.Handle(text)) Send(reply);
                }
                line.SetLength(0);
                if (router.ShouldExit) return;
            }
        }
    }
}
