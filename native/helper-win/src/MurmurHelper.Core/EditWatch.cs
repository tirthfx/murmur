using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>A text field being watched for corrections.</summary>
public interface IWatchedField
{
    /// <summary>The field's whole value now, or null when it cannot be read.</summary>
    string? Value();

    /// <summary>Whether this field still has the keyboard focus.</summary>
    bool IsFocused();
}

public interface IWatchedFieldSource
{
    /// <summary>The focused field, or null for a password, read-only or unreadable one.</summary>
    IWatchedField? Focused();
}

/// <summary>Where the inserted text is, and which of its words changed.</summary>
public static class EditDiff
{
    private const int MaxSpan = 200;

    public sealed record Change(string Before, string After, int Start, int Length);

    /// <summary>
    /// The words of the inserted span that changed between two values of the field. Null when
    /// nothing changed inside the span, or when the text around it changed too (then the span can
    /// no longer be found reliably).
    /// </summary>
    public static Change? Compare(string old, int start, int length, string now)
    {
        if (start < 0 || start + length > old.Length) return null;
        var suffix = old.Length - start - length;
        if (now.Length < start + suffix) return null;
        if (string.CompareOrdinal(old, 0, now, 0, start) != 0) return null;
        if (string.CompareOrdinal(old, old.Length - suffix, now, now.Length - suffix, suffix) != 0) return null;
        var newLength = now.Length - start - suffix;
        var before = old.Substring(start, length);
        var after = now.Substring(start, newLength);
        if (before == after) return null;
        var (changedBefore, changedAfter) = ChangedWords(before, after);
        return new Change(changedBefore, changedAfter, start, newLength);
    }

    /// <summary>Drops the words both sides share at the start and the end.</summary>
    private static (string, string) ChangedWords(string before, string after)
    {
        var a = before.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var b = after.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var head = 0;
        while (head < a.Length && head < b.Length && a[head] == b[head]) head++;
        var tail = 0;
        while (tail < a.Length - head && tail < b.Length - head && a[a.Length - 1 - tail] == b[b.Length - 1 - tail]) tail++;
        static string Clip(IEnumerable<string> words) => ContextWindow.After(string.Join(' ', words), MaxSpan);
        return (Clip(a[head..(a.Length - tail)]), Clip(b[head..(b.Length - tail)]));
    }
}

/// <summary>
/// <c>edits.watch</c> and <c>edits.cancel</c> (PZ-02). One watch at a time: the field is read every
/// half second; once an edit has rested for 1.5 s, the changed words are sent as
/// <c>edits.changed</c>. The field itself is never sent. The watch ends when the time is up, the
/// field loses focus, or it is cancelled.
/// </summary>
public sealed class EditWatchController(IWatchedFieldSource source, EventSink sink, int pollMs = 500, int restPolls = 3)
{
    private readonly object _gate = new();
    private int _generation;

    public JsonObject Watch(JsonObject p)
    {
        var text = Payload.Str(p, "text");
        var duration = Payload.Int(p, "durationMs");
        if (text.Length == 0 || duration is < 1000 or > 60_000)
            throw new HelperException(ErrorCode.InvalidPayload, "edits.watch needs text and durationMs (1000 to 60000)");
        var token = Next();
        var field = source.Focused();
        var value = field?.Value() is { } read ? ContextWindow.Lines(read) : null;
        var wanted = ContextWindow.Lines(text);
        var start = value?.LastIndexOf(wanted, StringComparison.Ordinal) ?? -1;
        if (field is null || value is null || start < 0) return new JsonObject { ["watching"] = false };
        var deadline = Environment.TickCount64 + duration;
        new Thread(() => Run(field, value, start, wanted.Length, token, deadline)) { IsBackground = true, Name = "edit-watch" }.Start();
        return new JsonObject { ["watching"] = true };
    }

    public JsonObject Cancel()
    {
        Next();
        return new JsonObject { ["cancelled"] = true };
    }

    private int Next()
    {
        lock (_gate) return ++_generation;
    }

    private bool IsCurrent(int token)
    {
        lock (_gate) return _generation == token;
    }

    private void Run(IWatchedField field, string value, int start, int length, int token, long deadline)
    {
        var baseline = value;
        var last = value;
        var resting = 0;
        while (IsCurrent(token) && Environment.TickCount64 < deadline)
        {
            Thread.Sleep(pollMs);
            string? now;
            try
            {
                if (!IsCurrent(token) || !field.IsFocused()) return;
                now = field.Value();
            }
            catch (Exception) { return; } // the app closed or stopped answering
            if (now is null) return;
            now = ContextWindow.Lines(now);
            if (now != last)
            {
                last = now;
                resting = 0;
                continue;
            }
            if (now == baseline || ++resting < restPolls) continue;
            // The text around the inserted words changed too: stop rather than guess.
            if (EditDiff.Compare(baseline, start, length, now) is not { } change) return;
            if (IsCurrent(token))
                sink("edits.changed", new JsonObject { ["before"] = change.Before, ["after"] = change.After });
            baseline = now;
            (start, length) = (change.Start, change.Length);
            resting = 0;
        }
    }
}
