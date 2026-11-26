using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>What is playing on the system.</summary>
public interface IMediaPlayback
{
    /// <summary>Null when the system does not say.</summary>
    bool? IsPlaying();

    /// <summary>Pauses what is playing. False when it did not take.</summary>
    bool Pause();

    /// <summary>Plays what <see cref="Pause"/> paused. False when there is nothing of ours to play.</summary>
    bool Resume();
}

/// <summary>
/// <c>media.playback</c>, <c>media.pause</c> and <c>media.resume</c> (DC-42). Pause acts only when
/// something is playing and says so, so main resumes only what Murmur paused.
/// </summary>
public sealed class PlaybackController(IMediaPlayback media)
{
    private const string Silent = "The system does not report what is playing";

    public JsonObject Playback()
    {
        var playing = media.IsPlaying();
        return new JsonObject { ["available"] = playing is not null, ["playing"] = playing };
    }

    public JsonObject Pause()
    {
        var playing = media.IsPlaying() ?? throw new HelperException(ErrorCode.DeviceNotFound, Silent);
        return new JsonObject { ["paused"] = playing && media.Pause() };
    }

    public JsonObject Resume()
    {
        if (media.IsPlaying() is null) throw new HelperException(ErrorCode.DeviceNotFound, Silent);
        return new JsonObject { ["resumed"] = media.Resume() };
    }
}
