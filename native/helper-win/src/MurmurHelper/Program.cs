using System.Diagnostics;
using System.Runtime.CompilerServices;
using Murmur.Helper;

// The Windows helper: speaks the helper protocol over stdin and stdout, one JSON message a line.
// MURMUR_HELPER_FAKE=1 runs it on a fake operating system (a text field, a tone for a microphone),
// which is how the app's conformance suite checks the protocol on any machine. It is never the default.

if (args.Contains("--self-test"))
{
    if (!OperatingSystem.IsWindows())
    {
        Console.Error.WriteLine("--self-test needs Windows.");
        return 2;
    }
    return RunSelfTest();
}

var fake = Environment.GetEnvironmentVariable("MURMUR_HELPER_FAKE") == "1";
var host = new Host(Console.OpenStandardInput(), Console.OpenStandardOutput());
EventSink sink = host.Emit;
Func<long> now = () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
var audioFolder = Path.Combine(Path.GetTempPath(), "murmur-helper");

IDisposable? cleanup = null;
Backends backends;
if (fake)
{
    backends = new FakeWorld(sink, now).Backends();
}
else if (OperatingSystem.IsWindows())
{
    (backends, cleanup) = CreateWindows(sink, now);
}
else
{
    Console.Error.WriteLine("This helper runs on Windows. Set MURMUR_HELPER_FAKE=1 to run it on a fake system.");
    return 2;
}

var mic = backends.Audio is null ? null : new MicSession(backends.Audio, backends.Permissions, sink, now, audioFolder);
var meeting = backends.Audio is null ? null : new MeetingCapture(backends.Audio, backends.Permissions, sink, now);
var router = new Router(backends, mic, meeting);
try
{
    host.Run(router);
}
finally
{
    router.Shutdown();
    cleanup?.Dispose();
}
return 0;

[MethodImpl(MethodImplOptions.NoInlining)]
static (Backends, IDisposable) CreateWindows(EventSink sink, Func<long> now) =>
    Murmur.Helper.Windows.WindowsBackends.Create(sink, now);

[MethodImpl(MethodImplOptions.NoInlining)]
static int RunSelfTest() => Murmur.Helper.Windows.SelfTest.Run(Console.Out);
