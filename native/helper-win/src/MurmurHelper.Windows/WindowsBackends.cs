namespace Murmur.Helper.Windows;

/// <summary>Puts the Windows pieces together. Timers poll the front window and the window list.</summary>
public static class WindowsBackends
{
    public static (Backends Backends, IDisposable Cleanup) Create(EventSink sink, Func<long> now)
    {
        HotkeyEngine? engine = null;
        var keyboard = new WindowsKeyboardHook((vk, down) => engine?.OnKey(vk, down));
        engine = new HotkeyEngine(sink, now, keyboard.Listen);

        var front = new FrontAppWatch(Windows.Front, sink);
        var detection = new MeetingDetection(Windows.VisibleWindows, sink);
        var frontTimer = new Timer(_ => { try { front.Tick(); } catch { /* the window went away */ } }, null, 250, 250);
        var detectTimer = new Timer(_ => { try { detection.Tick(); } catch { /* the window list changed */ } }, null, 2000, 2000);

        var backends = new Backends
        {
            Permissions = new WindowsPermissions(),
            Hotkeys = engine,
            Insertion = new WindowsInsertion(),
            SecureStore = new WindowsSecureStore(),
            Audio = new WindowsAudio(),
            FrontApp = front,
            Detection = detection,
            Output = new WindowsOutputMute(),
        };
        return (backends, new Disposables(keyboard, frontTimer, detectTimer));
    }

    private sealed class Disposables(params IDisposable[] items) : IDisposable
    {
        public void Dispose()
        {
            foreach (var item in items) item.Dispose();
        }
    }
}
