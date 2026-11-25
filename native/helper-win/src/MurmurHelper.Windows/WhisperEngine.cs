using Whisper.net;

namespace Murmur.Helper.Windows;

/// <summary>
/// Speech recognition with whisper.cpp through Whisper.net, on the CPU. The model is one ggml
/// file the app has already downloaded and checked; nothing here reaches the network.
/// </summary>
public sealed class WhisperEngine : ISpeechEngine
{
    private WhisperFactory? _factory;

    public string ComputeUnits => "cpu";

    public void Load(string model, string modelDir)
    {
        Unload();
        if (!Directory.Exists(modelDir))
            throw new FileNotFoundException($"The model folder does not exist: {modelDir}");
        var file = Directory.EnumerateFiles(modelDir, "*.bin", SearchOption.TopDirectoryOnly).OrderBy(f => f, StringComparer.Ordinal).FirstOrDefault()
            ?? throw new FileNotFoundException($"No ggml model file (.bin) in {modelDir}");
        _factory = WhisperFactory.FromPath(file);
    }

    public void Unload()
    {
        _factory?.Dispose();
        _factory = null;
    }

    public SpeechResult Transcribe(float[] samples, string? language, string? prompt, bool translate, CancellationToken cancel)
    {
        var factory = _factory ?? throw new InvalidOperationException("No model is loaded.");
        var builder = factory.CreateBuilder()
            .WithLanguage(language ?? "auto")
            .WithThreads(Math.Clamp(Environment.ProcessorCount, 2, 8));
        if (translate) builder = builder.WithTranslate();
        if (!string.IsNullOrWhiteSpace(prompt)) builder = builder.WithPrompt(prompt);
        using var processor = builder.Build();
        return Collect(processor, samples, language, cancel).GetAwaiter().GetResult();
    }

    private static async Task<SpeechResult> Collect(WhisperProcessor processor, float[] samples, string? language, CancellationToken cancel)
    {
        var segments = new List<SpeechSegment>();
        var detected = language;
        await foreach (var segment in processor.ProcessAsync(samples, cancel))
        {
            if (string.IsNullOrWhiteSpace(segment.Text)) continue;
            if (!string.IsNullOrEmpty(segment.Language)) detected ??= segment.Language;
            segments.Add(new SpeechSegment(
                (int)segment.Start.TotalMilliseconds,
                (int)segment.End.TotalMilliseconds,
                segment.Text.Trim(),
                Math.Clamp(segment.Probability, 0f, 1f)));
        }
        var text = string.Join(" ", segments.Select(s => s.Text));
        return new SpeechResult(text, (detected ?? "").ToLowerInvariant(), segments);
    }
}
