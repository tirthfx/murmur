using Windows.Media.Control;

namespace Murmur.Helper.Windows;

/// <summary>
/// What is playing, through the system's media transport controls (the same ones the volume
/// flyout shows). Only a session Murmur paused is played again.
/// </summary>
public sealed class WindowsMedia : IMediaPlayback
{
    private static readonly TimeSpan Limit = TimeSpan.FromSeconds(1);
    private readonly object _gate = new();
    private GlobalSystemMediaTransportControlsSession? _paused;

    private static T? Wait<T>(global::Windows.Foundation.IAsyncOperation<T> operation)
    {
        var task = operation.AsTask();
        return task.Wait(Limit) ? task.Result : default;
    }

    private static GlobalSystemMediaTransportControlsSessionManager? Manager() =>
        Wait(GlobalSystemMediaTransportControlsSessionManager.RequestAsync());

    private static bool Playing(GlobalSystemMediaTransportControlsSession session) =>
        session.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;

    public bool? IsPlaying()
    {
        try
        {
            var manager = Manager();
            return manager is null ? null : manager.GetSessions().Any(Playing);
        }
        catch (Exception) { return null; } // not on this edition of Windows
    }

    public bool Pause()
    {
        lock (_gate)
        {
            try
            {
                var session = Manager()?.GetSessions().FirstOrDefault(Playing);
                if (session is null || !Wait(session.TryPauseAsync())) return false;
                _paused = session;
                return true;
            }
            catch (Exception) { return false; }
        }
    }

    public bool Resume()
    {
        lock (_gate)
        {
            var session = _paused;
            _paused = null;
            if (session is null) return false;
            try { return Wait(session.TryPlayAsync()); }
            catch (Exception) { return false; } // the program that played it has closed
        }
    }
}
