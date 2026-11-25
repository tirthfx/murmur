using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>
/// Records a meeting's microphone and the computer's sound into chunk files, one set of chunks
/// per channel (NT-04). A chunk is written as <c>&lt;channel&gt;-&lt;n&gt;.partial.wav</c> and renamed when
/// it is closed, so a crash leaves only a partial file for the app to remove. Each closed chunk
/// is reported with its hash.
/// </summary>
public sealed class MeetingCapture
{
    private readonly IAudioSourceFactory _factory;
    private readonly IPermissionProvider _permissions;
    private readonly EventSink _sink;
    private readonly Func<long> _now;
    private readonly object _gate = new();
    private Meeting? _meeting;

    public MeetingCapture(IAudioSourceFactory factory, IPermissionProvider permissions, EventSink sink, Func<long> now)
    {
        _factory = factory;
        _permissions = permissions;
        _sink = sink;
        _now = now;
    }

    private sealed class Channel(string name, IAudioSource source, int chunkSamples)
    {
        public readonly string Name = name;
        public readonly IAudioSource Source = source;
        public readonly int ChunkSamples = chunkSamples;
        public WavWriter? Writer;
        public string? PartialPath;
        public int Seq;
        public long TotalSamples;
        public long ChunkStartSamples;
        public int Chunks;
        /// <summary>The samples of the chunk being written, kept for live text.</summary>
        public readonly List<float> Current = new();
        public readonly object Gate = new();
    }

    private sealed class Meeting(string id, string folder, long startedAt)
    {
        public readonly string Id = id;
        public readonly string Folder = folder;
        public readonly long StartedAt = startedAt;
        public readonly List<Channel> Channels = new();
    }

    public JsonObject Start(JsonObject p)
    {
        var meetingId = Payload.Str(p, "meetingId");
        var folder = Payload.Str(p, "folder");
        if (!Paths.IsAbsolute(folder)) throw new HelperException(ErrorCode.InvalidPayload, "folder must be an absolute path");
        var wanted = Payload.Strings(p, "channels");
        if (wanted.Count == 0) wanted = new[] { "mic", "system" };
        if (wanted.Any(c => c is not ("mic" or "system"))) throw new HelperException(ErrorCode.InvalidPayload, "channels are mic and system");
        var chunkSeconds = Payload.TryInt(p, "chunkSeconds") ?? 30;
        if (chunkSeconds is < 1 or > 300) throw new HelperException(ErrorCode.InvalidPayload, "chunkSeconds is 1 to 300");

        lock (_gate)
        {
            if (_meeting is not null) throw new HelperException(ErrorCode.Busy, "A meeting is already being recorded.");
            _meeting = new Meeting(meetingId, folder, _now());
        }
        var meeting = _meeting!;
        var warnings = new JsonArray();
        var channelNames = new JsonObject();
        try
        {
            Directory.CreateDirectory(folder);
            if (wanted.Contains("mic"))
            {
                if (_permissions.Status("microphone") == "denied")
                    throw new HelperException(ErrorCode.PermissionDenied, "Microphone access is off for Murmur.");
                var mic = _factory.Microphone(Payload.TryStr(p, "micDeviceId"));
                meeting.Channels.Add(new Channel("mic", mic, chunkSeconds * WavWriter.SampleRate));
                channelNames["mic"] = mic.DeviceName;
            }
            if (wanted.Contains("system"))
            {
                IAudioSource? system = null;
                try { system = _factory.SystemOutput(); } catch (HelperException) { }
                if (system is null) warnings.Add("system_unavailable");
                else
                {
                    meeting.Channels.Add(new Channel("system", system, chunkSeconds * WavWriter.SampleRate));
                    channelNames["system"] = system.DeviceName;
                }
            }
            if (meeting.Channels.Count == 0) throw new HelperException(ErrorCode.DeviceNotFound, "No channel could be started.");
            foreach (var channel in meeting.Channels)
            {
                channel.Source.Samples += samples => OnSamples(meeting, channel, samples);
                channel.Source.Failed += code => ChannelFailed(meeting, channel, code);
                channel.Source.Start();
            }
        }
        catch (Exception error)
        {
            Abort(meeting);
            lock (_gate) _meeting = null;
            if (error is HelperException) throw;
            throw new HelperException(ErrorCode.AudioEngineFailed, error.Message);
        }
        return new JsonObject
        {
            ["startedAt"] = meeting.StartedAt,
            ["channels"] = channelNames,
            ["sampleRate"] = WavWriter.SampleRate,
            ["warnings"] = warnings,
        };
    }

    private void OnSamples(Meeting meeting, Channel channel, float[] samples)
    {
        var closed = new List<JsonObject>();
        lock (channel.Gate)
        {
            if (_meeting != meeting) return;
            var offset = 0;
            while (offset < samples.Length)
            {
                if (channel.Writer is null) OpenChunk(meeting, channel);
                var room = channel.ChunkSamples - (int)(channel.TotalSamples - channel.ChunkStartSamples);
                var take = Math.Min(room, samples.Length - offset);
                channel.Writer!.Write(samples.AsSpan(offset, take));
                channel.Current.AddRange(samples.AsSpan(offset, take).ToArray());
                channel.TotalSamples += take;
                offset += take;
                if (channel.TotalSamples - channel.ChunkStartSamples >= channel.ChunkSamples) closed.Add(CloseChunk(meeting, channel));
            }
        }
        foreach (var chunk in closed) _sink("capture.chunk", chunk);
        var (rms, _) = Levels.Measure(samples);
        _sink("capture.level", new JsonObject { ["meetingId"] = meeting.Id, ["channel"] = channel.Name, ["rmsDb"] = rms });
    }

    private void ChannelFailed(Meeting meeting, Channel channel, string code)
    {
        var issue = code is "device_lost" or "write_failed" ? code : "device_lost";
        _sink("capture.error", new JsonObject { ["meetingId"] = meeting.Id, ["channel"] = channel.Name, ["code"] = issue });
    }

    private static string ChunkPath(Meeting m, Channel c, bool partial) =>
        Path.Combine(m.Folder, partial ? $"{c.Name}-{c.Seq}.partial.wav" : $"{c.Name}-{c.Seq}.wav");

    private static void OpenChunk(Meeting meeting, Channel channel)
    {
        channel.Seq++;
        channel.ChunkStartSamples = channel.TotalSamples;
        channel.PartialPath = ChunkPath(meeting, channel, partial: true);
        channel.Writer = new WavWriter(channel.PartialPath);
        channel.Current.Clear();
    }

    private static JsonObject CloseChunk(Meeting meeting, Channel channel)
    {
        var writer = channel.Writer!;
        var samples = writer.Samples;
        writer.Dispose();
        channel.Writer = null;
        channel.Current.Clear();
        var final = ChunkPath(meeting, channel, partial: false);
        File.Move(channel.PartialPath!, final, overwrite: true);
        channel.Chunks++;
        return new JsonObject
        {
            ["meetingId"] = meeting.Id,
            ["channel"] = channel.Name,
            ["seq"] = channel.Seq,
            ["path"] = final,
            ["sha256"] = WavWriter.Sha256Hex(final),
            ["bytes"] = new FileInfo(final).Length,
            ["startMs"] = channel.ChunkStartSamples * 1000 / WavWriter.SampleRate,
            ["durationMs"] = samples * 1000 / WavWriter.SampleRate,
        };
    }

    /// <summary>
    /// The chunk still being written on a channel: its number, where it starts on the timeline and
    /// the samples so far (a copy). Null when no such meeting or channel is being recorded.
    /// </summary>
    public (int Seq, long StartMs, float[] Samples)? LiveAudio(string meetingId, string channelName)
    {
        Meeting? meeting;
        lock (_gate) meeting = _meeting;
        if (meeting is null || meeting.Id != meetingId) return null;
        var channel = meeting.Channels.FirstOrDefault(c => c.Name == channelName);
        if (channel is null) return null;
        lock (channel.Gate)
        {
            if (channel.Writer is null)
                return (channel.Seq + 1, channel.TotalSamples * 1000 / WavWriter.SampleRate, Array.Empty<float>());
            return (channel.Seq, channel.ChunkStartSamples * 1000 / WavWriter.SampleRate, channel.Current.ToArray());
        }
    }

    public JsonObject Stop(JsonObject p)
    {
        var id = Payload.Str(p, "meetingId");
        Meeting meeting;
        lock (_gate)
        {
            if (_meeting is null || _meeting.Id != id) throw new HelperException(ErrorCode.NotFound, "There is no such meeting recording.");
            meeting = _meeting;
        }
        var summary = new JsonObject();
        foreach (var channel in meeting.Channels)
        {
            channel.Source.Stop();
            JsonObject? last = null;
            lock (channel.Gate)
            {
                if (channel.Writer is not null) last = channel.Writer.Samples > 0 ? CloseChunk(meeting, channel) : DropEmpty(channel);
            }
            if (last is not null) _sink("capture.chunk", last);
            channel.Source.Dispose();
            summary[channel.Name] = new JsonObject
            {
                ["chunks"] = channel.Chunks,
                ["durationMs"] = channel.TotalSamples * 1000 / WavWriter.SampleRate,
            };
        }
        lock (_gate) _meeting = null;
        return new JsonObject
        {
            ["durationMs"] = Math.Max(0, _now() - meeting.StartedAt),
            ["channels"] = summary,
        };
    }

    private static JsonObject? DropEmpty(Channel channel)
    {
        channel.Writer!.Dispose();
        channel.Writer = null;
        try { File.Delete(channel.PartialPath!); } catch { /* gone */ }
        return null;
    }

    private static void Abort(Meeting meeting)
    {
        foreach (var channel in meeting.Channels)
        {
            try { channel.Source.Stop(); } catch { /* not started */ }
            channel.Source.Dispose();
            channel.Writer?.Dispose();
        }
    }

    public void Shutdown()
    {
        Meeting? meeting;
        lock (_gate) { meeting = _meeting; _meeting = null; }
        if (meeting is not null) Abort(meeting);
    }
}

public static class Paths
{
    /// <summary>A POSIX, Windows drive or network share path. The same rule as the TypeScript side.</summary>
    public static bool IsAbsolute(string value) =>
        System.Text.RegularExpressions.Regex.IsMatch(value, @"^(/|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])");
}
