using System.Buffers.Binary;
using System.Security.Cryptography;

namespace Murmur.Helper;

/// <summary>Writes 16 kHz mono 16-bit PCM into a WAV file. The length fields are filled in on close.</summary>
public sealed class WavWriter : IDisposable
{
    public const int SampleRate = 16000;
    private readonly FileStream _file;
    private long _dataBytes;

    public WavWriter(string path)
    {
        _file = new FileStream(path, FileMode.Create, FileAccess.ReadWrite, FileShare.Read);
        _file.Write(new byte[44]); // header, written for real on close
    }

    public long Samples => _dataBytes / 2;

    public void Write(ReadOnlySpan<float> samples)
    {
        var bytes = new byte[samples.Length * 2];
        for (var i = 0; i < samples.Length; i++)
        {
            var clipped = Math.Clamp(samples[i], -1f, 1f);
            BinaryPrimitives.WriteInt16LittleEndian(bytes.AsSpan(i * 2), (short)Math.Round(clipped * short.MaxValue));
        }
        _file.Write(bytes);
        _dataBytes += bytes.Length;
    }

    public void Dispose()
    {
        if (!_file.CanWrite) return;
        var header = new byte[44];
        "RIFF"u8.CopyTo(header);
        BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(4), (int)(36 + _dataBytes));
        "WAVEfmt "u8.CopyTo(header.AsSpan(8));
        BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(16), 16);
        BinaryPrimitives.WriteInt16LittleEndian(header.AsSpan(20), 1); // PCM
        BinaryPrimitives.WriteInt16LittleEndian(header.AsSpan(22), 1); // mono
        BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(24), SampleRate);
        BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(28), SampleRate * 2);
        BinaryPrimitives.WriteInt16LittleEndian(header.AsSpan(32), 2);
        BinaryPrimitives.WriteInt16LittleEndian(header.AsSpan(34), 16);
        "data"u8.CopyTo(header.AsSpan(36));
        BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(40), (int)_dataBytes);
        _file.Seek(0, SeekOrigin.Begin);
        _file.Write(header);
        _file.Dispose();
    }

    public static string Sha256Hex(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }
}

public static class Levels
{
    public const double FloorDb = -120;

    public static double Db(double amplitude) => amplitude <= 1e-6 ? FloorDb : Math.Max(FloorDb, 20 * Math.Log10(amplitude));

    public static (double RmsDb, double PeakDb) Measure(ReadOnlySpan<float> samples)
    {
        if (samples.IsEmpty) return (FloorDb, FloorDb);
        double sum = 0, peak = 0;
        foreach (var s in samples)
        {
            sum += (double)s * s;
            peak = Math.Max(peak, Math.Abs(s));
        }
        return (Db(Math.Sqrt(sum / samples.Length)), Db(peak));
    }
}
