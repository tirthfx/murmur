using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>An element in an app's accessibility tree, as the inspector sees it.</summary>
public interface IInspectable
{
    string? Role { get; }
    string? Title { get; }
    bool Editable { get; }
    bool Secure { get; }

    /// <summary>Only asked for on a field that is not a password.</summary>
    (int Location, int Length)? SelectedRange();

    /// <summary>Only asked for when values are shown, and never for a password field.</summary>
    string? Value();

    IReadOnlyList<IInspectable> Children();
}

public interface IInspectSource
{
    /// <summary>The app in front and its window, or null when there is none.</summary>
    (FrontAppInfo App, IInspectable Window)? Target();
}

/// <summary><c>ax.inspect</c> (HB-56): the window in front as rows, at most six deep and 500 rows. Nothing is kept.</summary>
public sealed class InspectController(IInspectSource source)
{
    public const int MaxDepth = 6;
    public const int MaxNodes = 500;
    private const int MaxValue = 200;

    public JsonObject Inspect(JsonObject p)
    {
        var showValues = Payload.Bool(p, "showValues");
        var rows = new JsonArray();
        var truncated = false;
        var target = source.Target();
        if (target is { } found)
        {
            var stack = new Stack<(IInspectable Element, int Depth)>();
            stack.Push((found.Window, 0));
            while (stack.Count > 0)
            {
                if (rows.Count >= MaxNodes)
                {
                    truncated = true;
                    break;
                }
                var (element, depth) = stack.Pop();
                var secure = element.Secure;
                var range = secure ? null : element.SelectedRange();
                var value = showValues && !secure ? element.Value() : null;
                rows.Add(new JsonObject
                {
                    ["depth"] = depth,
                    ["role"] = Clip(element.Role, 80),
                    ["subrole"] = null,
                    ["title"] = Clip(element.Title, 200),
                    ["editable"] = element.Editable,
                    ["secure"] = secure,
                    ["selectedRange"] = range is { } r ? new JsonArray(r.Location, r.Length) : null,
                    ["value"] = Clip(value, MaxValue),
                });
                var children = element.Children();
                if (depth >= MaxDepth)
                {
                    truncated |= children.Count > 0;
                    continue;
                }
                // Pushed in reverse so the first child is visited first.
                for (var i = children.Count - 1; i >= 0; i--) stack.Push((children[i], depth + 1));
            }
        }
        return new JsonObject
        {
            ["app"] = Clip(target?.App.Name, 200),
            ["bundleId"] = Clip(target?.App.ProcessName, 255),
            ["nodes"] = rows,
            ["truncated"] = truncated,
        };
    }

    private static string? Clip(string? text, int max) => text is null ? null : ContextWindow.After(text, max);
}
