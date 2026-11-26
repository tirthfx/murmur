using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Murmur.Helper;

public enum SelectionKind
{
    /// <summary>No focused element.</summary>
    NoFocus,
    /// <summary>A password field. Nothing was read.</summary>
    Secure,
    /// <summary>The element does not report a selection.</summary>
    Unsupported,
    /// <summary>The selection. <c>Text</c> is null when it was over the limit and so not read.</summary>
    Selected,
}

/// <summary>What UI Automation says about the selection in the focused element.</summary>
public sealed record FocusedSelection(SelectionKind Kind, string? Text = null, int? Location = null, int Length = 0);

/// <summary>The OS calls behind <c>selection.read</c>. The rules for using them are in <see cref="SelectionController"/>.</summary>
public interface ISelectionPlatform
{
    /// <summary>Must not read text from a password field, nor much more than <paramref name="maxLength"/> UTF-16 units.</summary>
    FocusedSelection Read(int maxLength);

    /// <summary>The process image name of the app in front (any case), or null.</summary>
    string? FrontProcessName();

    /// <summary>Changes every time something writes to the clipboard.</summary>
    uint ClipboardSequence { get; }

    /// <summary>What the clipboard holds, to put back later. Null when it cannot be saved.</summary>
    object? SaveClipboard();

    string? ReadClipboardText();
    void RestoreClipboard(object saved);

    /// <summary>
    /// Asks the app in front to copy, with Ctrl+Insert: in a terminal, Ctrl+C would interrupt the
    /// running program when nothing is selected, and Ctrl+Insert never does.
    /// </summary>
    bool PressCopy();
}

/// <summary>
/// <c>selection.read</c> (RW-01): the selected text through UI Automation, or copied with the
/// clipboard put back. Nothing is kept. One read at a time.
/// </summary>
public sealed class SelectionController(ISelectionPlatform platform, Action<int>? sleep = null)
{
    public const int MaxLength = 8000;
    private const int PollMs = 20;
    private readonly Action<int> _sleep = sleep ?? Thread.Sleep;
    private int _busy;

    private sealed record Outcome(string Status, string Text = "", int Length = 0, int? Location = null, string? Source = null);

    public JsonObject Read(JsonObject p)
    {
        var fallback = Payload.TryBool(p, "clipboardFallback") ?? true;
        var wait = p.ContainsKey("copyWaitMs") ? Payload.Int(p, "copyWaitMs") : 250;
        if (wait is < 50 or > 1000) throw new HelperException(ErrorCode.InvalidPayload, "copyWaitMs must be from 50 to 1000");
        var firstApps = Payload.Strings(p, "clipboardFirstInApps");
        if (Interlocked.CompareExchange(ref _busy, 1, 0) != 0)
            throw new HelperException(ErrorCode.Busy, "Another selection read is running");
        try
        {
            var app = platform.FrontProcessName();
            var copyFirst = app is not null && firstApps.Any(item => string.Equals(item, app, StringComparison.OrdinalIgnoreCase));
            return Result(Decide(fallback, copyFirst, wait), app);
        }
        finally { Interlocked.Exchange(ref _busy, 0); }
    }

    private Outcome Decide(bool fallback, bool copyFirst, int wait)
    {
        var seen = platform.Read(MaxLength);
        // A password field is never copied either.
        if (seen.Kind == SelectionKind.Secure) return new Outcome("secure");
        if (fallback && copyFirst) return Copy(wait);
        if (seen.Kind != SelectionKind.Selected) return fallback ? Copy(wait) : new Outcome("unavailable");

        var text = seen.Text is null ? null : Normalize(seen.Text);
        if (seen.Length > MaxLength || text?.Length > MaxLength)
            return new Outcome("too_long", Length: Math.Max(seen.Length, text?.Length ?? 0), Location: seen.Location);
        if (text is null)
        {
            // A range but no text: the element would not say, so copy it.
            if (seen.Length > 0) return fallback ? Copy(wait) : new Outcome("unavailable");
            return new Outcome("empty", Location: seen.Location);
        }
        return text.Length == 0
            ? new Outcome("empty", Location: seen.Location)
            : new Outcome("ok", text, text.Length, seen.Location, "ax");
    }

    /// <summary>
    /// Ctrl+Insert, wait for the clipboard to change, read it, put the old contents back. An
    /// unchanged clipboard means nothing was selected (or the app does not copy). A clipboard that
    /// cannot be saved is not copied over.
    /// </summary>
    private Outcome Copy(int wait)
    {
        var saved = platform.SaveClipboard();
        if (saved is null) return new Outcome("unavailable");
        var before = platform.ClipboardSequence;
        if (!platform.PressCopy()) return new Outcome("unavailable");
        var waited = 0;
        string? text = null;
        // The app may empty the clipboard before it writes, so wait for text, not only for a change.
        while (true)
        {
            if (platform.ClipboardSequence != before) text = platform.ReadClipboardText();
            if (!string.IsNullOrEmpty(text) || waited >= wait) break;
            _sleep(PollMs);
            waited += PollMs;
        }
        var after = platform.ClipboardSequence;
        if (after == before) return new Outcome("empty");
        text ??= platform.ReadClipboardText() ?? "";
        // Put back what the person had, unless something else wrote in the meantime.
        if (platform.ClipboardSequence == after) platform.RestoreClipboard(saved);
        text = Normalize(text);
        if (text.Length > MaxLength) return new Outcome("too_long", Length: text.Length);
        return text.Length == 0 ? new Outcome("empty") : new Outcome("ok", text, text.Length, Source: "clipboard");
    }

    /// <summary>Windows fields end lines with CR LF; the app compares and counts lines as one character.</summary>
    private static string Normalize(string text) => text.Replace("\r\n", "\n").Replace('\r', '\n');

    private static JsonObject Result(Outcome outcome, string? app)
    {
        var ok = outcome.Status == "ok";
        return new JsonObject
        {
            ["status"] = outcome.Status,
            ["text"] = ok ? outcome.Text : "",
            ["length"] = outcome.Length,
            ["range"] = outcome.Location is { } location
                ? new JsonObject { ["location"] = Math.Max(0, location), ["length"] = outcome.Length }
                : null,
            ["hash"] = ok ? Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(outcome.Text))).ToLowerInvariant() : "",
            ["source"] = ok ? outcome.Source : null,
            ["appBundleId"] = app,
        };
    }
}
