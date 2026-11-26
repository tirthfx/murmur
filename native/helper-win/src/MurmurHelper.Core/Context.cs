using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>The focused element: what kind it is, whether it takes text, and the text beside the caret.</summary>
public sealed record FocusedField(string? Role, bool Editable, bool Secure, string TextBefore = "", string TextAfter = "");

/// <summary>Reads the app in front and its focused element.</summary>
public interface IFocusReader
{
    FrontAppInfo? App();
    string? WindowTitle();

    /// <summary>Null when nothing has focus. Must not read any text from a password field.</summary>
    FocusedField? Field(int maxBefore, int maxAfter);
}

/// <summary>Cuts text to the characters nearest the caret without splitting one.</summary>
public static class ContextWindow
{
    public static string Before(string text, int max)
    {
        if (text.Length <= max) return text;
        var start = text.Length - max;
        if (start < text.Length && char.IsLowSurrogate(text[start])) start++;
        return text[start..];
    }

    public static string After(string text, int max)
    {
        if (text.Length <= max) return text;
        var end = max;
        if (end > 0 && char.IsHighSurrogate(text[end - 1])) end--;
        return text[..end];
    }

    /// <summary>Windows ends lines with CR LF; the app counts a line end as one character.</summary>
    public static string Lines(string text) => text.Replace("\r\n", "\n").Replace('\r', '\n');
}

/// <summary><c>context.snapshot</c> (DC-30): held by the app for one dictation, never written anywhere here.</summary>
public sealed class ContextController(IFocusReader reader)
{
    public const int MaxBefore = 1500;
    public const int MaxAfter = 300;

    public JsonObject Snapshot(JsonObject p)
    {
        var before = p.ContainsKey("maxBefore") ? Payload.Int(p, "maxBefore") : MaxBefore;
        var after = p.ContainsKey("maxAfter") ? Payload.Int(p, "maxAfter") : MaxAfter;
        if (before is < 0 or > MaxBefore || after is < 0 or > MaxAfter)
            throw new HelperException(ErrorCode.InvalidPayload, $"maxBefore must be 0 to {MaxBefore} and maxAfter 0 to {MaxAfter}");
        var app = reader.App();
        var title = reader.WindowTitle();
        var field = reader.Field(before, after);
        // Whatever the reader did, a password field gives no text.
        var secure = field?.Secure ?? false;
        return new JsonObject
        {
            ["appName"] = app?.Name,
            ["bundleId"] = app?.ProcessName,
            ["windowTitle"] = string.IsNullOrEmpty(title) ? null : title,
            ["role"] = field?.Role,
            ["subrole"] = null,
            ["editable"] = field?.Editable ?? false,
            ["secure"] = secure,
            ["textBefore"] = secure ? "" : ContextWindow.Before(ContextWindow.Lines(field?.TextBefore ?? ""), before),
            ["textAfter"] = secure ? "" : ContextWindow.After(ContextWindow.Lines(field?.TextAfter ?? ""), after),
        };
    }
}
