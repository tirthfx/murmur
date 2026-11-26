using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;

namespace Murmur.Helper.Windows;

/// <summary>
/// Microphone and loopback capture through WASAPI in shared mode. Each device's own format is
/// converted to 16 kHz mono by <see cref="Resampler"/>. The system channel is the default output,
/// so it records everything playing (SW-11); per-app capture is not done.
/// </summary>
public sealed class WindowsAudio : IAudioSourceFactory, IDisposable
{
    private readonly MMDeviceEnumerator _watching = new();
    private readonly Notifications _notifications;

    public WindowsAudio()
    {
        _notifications = new Notifications(() => DevicesChanged?.Invoke());
        try { _watching.RegisterEndpointNotificationCallback(_notifications); }
        catch (System.Runtime.InteropServices.COMException) { /* no audio service: nothing to report */ }
    }

    public event Action? DevicesChanged;

    public void Dispose()
    {
        try { _watching.UnregisterEndpointNotificationCallback(_notifications); } catch (System.Runtime.InteropServices.COMException) { }
        _watching.Dispose();
    }

    /// <summary>Windows calls these on its own thread; nothing is looked up inside them.</summary>
    private sealed class Notifications(Action changed) : IMMNotificationClient
    {
        public void OnDeviceStateChanged(string deviceId, DeviceState newState) => changed();
        public void OnDeviceAdded(string deviceId) => changed();
        public void OnDeviceRemoved(string deviceId) => changed();
        public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId)
        {
            if (flow == DataFlow.Capture) changed();
        }
        public void OnPropertyValueChanged(string deviceId, PropertyKey key) { }
    }

    public IReadOnlyList<AudioDeviceInfo> Devices()
    {
        using var enumerator = new MMDeviceEnumerator();
        string? defaultId = null;
        try { defaultId = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications).ID; } catch { /* no input */ }
        var list = new List<AudioDeviceInfo>();
        foreach (var device in enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
        {
            int rate = 0;
            try { rate = device.AudioClient.MixFormat.SampleRate; } catch { /* busy */ }
            list.Add(new AudioDeviceInfo(device.ID, device.FriendlyName, device.ID == defaultId, "other", rate));
        }
        return list;
    }

    public IAudioSource Microphone(string? deviceId)
    {
        using var enumerator = new MMDeviceEnumerator();
        try
        {
            var device = deviceId is null
                ? enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications)
                : enumerator.GetDevice(deviceId);
            return new WasapiSource(device.ID, device.FriendlyName, new WasapiCapture(device));
        }
        catch (Exception error) when (error is System.Runtime.InteropServices.COMException or ArgumentException)
        {
            throw new HelperException(ErrorCode.DeviceNotFound, "No microphone is connected.");
        }
    }

    public IAudioSource? SystemOutput()
    {
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            var device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            return new WasapiSource(device.ID, device.FriendlyName, new WasapiLoopbackCapture(device));
        }
        catch (System.Runtime.InteropServices.COMException)
        {
            return null;
        }
    }

    private static readonly Guid IeeeFloatSubFormat = new("00000003-0000-0010-8000-00aa00389b71");

    private sealed class WasapiSource : IAudioSource
    {
        private readonly WasapiCapture _capture;
        private readonly Resampler _resampler;
        private readonly bool _float;
        private readonly int _bits;

        public WasapiSource(string id, string name, WasapiCapture capture)
        {
            DeviceId = id;
            DeviceName = name;
            _capture = capture;
            var format = capture.WaveFormat;
            _float = format.Encoding == WaveFormatEncoding.IeeeFloat
                || (format is WaveFormatExtensible ext && ext.SubFormat == IeeeFloatSubFormat);
            _bits = format.BitsPerSample;
            _resampler = new Resampler(format.SampleRate, format.Channels);
            capture.DataAvailable += (_, e) =>
            {
                if (e.BytesRecorded == 0) return;
                var floats = Resampler.ToFloats(e.Buffer.AsSpan(0, e.BytesRecorded), _float, _bits);
                var mono = _resampler.Process(floats);
                if (mono.Length > 0) Samples?.Invoke(mono);
            };
            capture.RecordingStopped += (_, e) =>
            {
                if (e.Exception is not null) Failed?.Invoke("device_lost");
            };
        }

        public string DeviceName { get; }
        public string? DeviceId { get; }
        public event Action<float[]>? Samples;
        public event Action<string>? Failed;
        public void Start() => _capture.StartRecording();
        public void Stop() { try { _capture.StopRecording(); } catch { /* not recording */ } }
        public void Dispose() => _capture.Dispose();
    }
}

/// <summary>The default output's mute switch. Restoring it after a crash is the app's job (it keeps a recovery marker).</summary>
public sealed class WindowsOutputMute : IOutputMute
{
    public bool? Muted
    {
        get
        {
            try
            {
                using var enumerator = new MMDeviceEnumerator();
                return enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia).AudioEndpointVolume.Mute;
            }
            catch { return null; }
        }
    }

    public void SetMuted(bool muted)
    {
        using var enumerator = new MMDeviceEnumerator();
        enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia).AudioEndpointVolume.Mute = muted;
    }
}
