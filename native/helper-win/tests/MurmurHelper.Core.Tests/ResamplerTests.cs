using Xunit;

namespace Murmur.Helper.Tests;

public class ResamplerTests
{
    [Fact]
    public void ADownmixAveragesTheChannels()
    {
        var r = new Resampler(16000, 2);
        Assert.Equal(new[] { 0.5f, 0f }, r.Process(new[] { 1f, 0f, 0.5f, -0.5f }));
    }

    [Fact]
    public void ResamplingKeepsTheLengthInProportion()
    {
        var r = new Resampler(48000, 1);
        var total = 0;
        for (var i = 0; i < 100; i++) total += r.Process(new float[480]).Length; // 1 s in chunks of 10 ms
        Assert.InRange(total, 15990, 16000);
    }

    [Fact]
    public void ChunkBoundariesDoNotChangeTheResult()
    {
        var input = Enumerable.Range(0, 4800).Select(i => (float)Math.Sin(i / 20.0)).ToArray();
        var whole = new Resampler(48000, 1).Process(input);
        var parts = new List<float>();
        var split = new Resampler(48000, 1);
        for (var i = 0; i < input.Length; i += 700) parts.AddRange(split.Process(input.AsSpan(i, Math.Min(700, input.Length - i))));
        Assert.InRange(parts.Count, whole.Length - 2, whole.Length + 2);
        for (var i = 0; i < Math.Min(parts.Count, whole.Length) - 2; i++) Assert.Equal(whole[i], parts[i], 3);
    }

    [Fact]
    public void ASineKeepsItsLevelWhenResampled()
    {
        var input = Enumerable.Range(0, 44100).Select(i => 0.5f * (float)Math.Sin(2 * Math.PI * 440 * i / 44100)).ToArray();
        var output = new Resampler(44100, 1).Process(input);
        Assert.InRange(output.Max(), 0.49, 0.5);
    }

    [Fact]
    public void ReadsFloatAndSixteenBitSamples()
    {
        var floats = BitConverter.GetBytes(0.25f);
        Assert.Equal(new[] { 0.25f }, Resampler.ToFloats(floats, isFloat: true, 32));
        var ints = BitConverter.GetBytes((short)16384);
        Assert.Equal(new[] { 0.5f }, Resampler.ToFloats(ints, isFloat: false, 16));
        Assert.Throws<NotSupportedException>(() => Resampler.ToFloats(new byte[3], false, 24));
    }
}
