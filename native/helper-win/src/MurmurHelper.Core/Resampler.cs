namespace Murmur.Helper;

/// <summary>Turns what a device delivers (any channel count and sample rate) into 16 kHz mono floats.</summary>
public sealed class Resampler
{
    private readonly int _channels;
    private readonly double _step;
    private double _position;
    private float _previous;
    private bool _hasPrevious;

    public Resampler(int sourceRate, int channels, int targetRate = WavWriter.SampleRate)
    {
        if (sourceRate <= 0 || channels <= 0) throw new ArgumentException("rate and channels must be positive");
        _channels = channels;
        _step = (double)sourceRate / targetRate;
    }

    /// <summary>Interleaved samples in, mono samples at the target rate out. Linear interpolation, carried across calls.</summary>
    public float[] Process(ReadOnlySpan<float> interleaved)
    {
        var frames = interleaved.Length / _channels;
        var mono = new float[frames];
        for (var i = 0; i < frames; i++)
        {
            float sum = 0;
            for (var c = 0; c < _channels; c++) sum += interleaved[i * _channels + c];
            mono[i] = sum / _channels;
        }
        if (_step == 1.0) return mono;

        // Position is counted from the previous call's last frame (index -1).
        var output = new List<float>((int)(frames / _step) + 2);
        while (true)
        {
            var index = (int)Math.Floor(_position);
            var fraction = (float)(_position - index);
            var left = index < 0 ? (_hasPrevious ? _previous : 0f) : (index < frames ? mono[index] : float.NaN);
            var right = index + 1 < frames ? mono[index + 1] : float.NaN;
            if (float.IsNaN(left) || float.IsNaN(right)) break;
            output.Add(left + (right - left) * fraction);
            _position += _step;
        }
        if (frames > 0)
        {
            _position -= frames;
            _previous = mono[frames - 1];
            _hasPrevious = true;
        }
        return output.ToArray();
    }

    /// <summary>Reads little-endian samples as floats: 32-bit float or 16-bit integer.</summary>
    public static float[] ToFloats(ReadOnlySpan<byte> bytes, bool isFloat, int bitsPerSample)
    {
        if (isFloat && bitsPerSample == 32)
        {
            var result = new float[bytes.Length / 4];
            for (var i = 0; i < result.Length; i++) result[i] = BitConverter.ToSingle(bytes.Slice(i * 4, 4));
            return result;
        }
        if (!isFloat && bitsPerSample == 16)
        {
            var result = new float[bytes.Length / 2];
            for (var i = 0; i < result.Length; i++) result[i] = BitConverter.ToInt16(bytes.Slice(i * 2, 2)) / 32768f;
            return result;
        }
        throw new NotSupportedException($"Samples of {bitsPerSample} bits ({(isFloat ? "float" : "integer")}) are not supported.");
    }
}
