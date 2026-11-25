using Whisper.net;
using Whisper.net.LibraryLoader;

namespace Murmur.Helper.Windows;

/// <summary>
/// Speech recognition with whisper.cpp through Whisper.net, on the CPU. The model is one ggml
/// file the app has already downloaded and checked; nothing here reaches the network.
/// </summary>
public sealed class WhisperEngine : ISpeechEngine
{
    private WhisperFactory? _factory;

    /// <summary>
    /// Whisper.net looks for its native library under <c>runtimes/win-x64</c> next to the program. A
    /// single-file helper carries the libraries inside and the host unpacks them, keeping that
    /// <c>runtimes</c> layout, into a folder it lists in NATIVE_DLL_SEARCH_DIRECTORIES. Point
    /// Whisper.net at that copy when the usual place is empty.
    /// </summary>
    private static string? LocateNativeLibrary()
    {
        if (File.Exists(Path.Combine(AppContext.BaseDirectory, "runtimes", "win-x64", "whisper.dll"))) return null;
        var listed = AppContext.GetData("NATIVE_DLL_SEARCH_DIRECTORIES") as string ?? "";
        foreach (var dir in listed.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            foreach (var candidate in new[] { Path.Combine(dir, "runtimes", "win-x64", "whisper.dll"), Path.Combine(dir, "whisper.dll") })
            {
                if (File.Exists(candidate)) return candidate;
            }
        }
        return null;
    }

    /// <summary>Where the native library was looked for, for a failure message.</summary>
    public static string NativeSearchReport() =>
        $"base={AppContext.BaseDirectory}; found={LocateNativeLibrary() ?? "none"}";

    public void Load(string model, string modelDir)
    {
        Unload();
        if (!Directory.Exists(modelDir))
            throw new FileNotFoundException($"The model folder does not exist: {modelDir}");
        var file = Directory.EnumerateFiles(modelDir, "*.bin", SearchOption.TopDirectoryOnly).OrderBy(f => f, StringComparer.Ordinal).FirstOrDefault()
            ?? throw new FileNotFoundException($"No ggml model file (.bin) in {modelDir}");
        var native = LocateNativeLibrary();
        if (native is not null) RuntimeOptions.LibraryPath = native;
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
