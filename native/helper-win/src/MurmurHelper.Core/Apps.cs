using System.Text;
using System.Text.Json.Nodes;

namespace Murmur.Helper;

public sealed record ProcessRow(int Pid, int ParentPid, string Name);

/// <summary>The process table and the app in front.</summary>
public interface IProcessTable
{
    int? FrontProcessId();
    IReadOnlyList<ProcessRow> Rows();

    /// <summary>The command line of one process, or null. Only asked for interpreters, and never sent anywhere.</summary>
    string? CommandLine(int pid);
}

/// <summary>
/// <c>proc.foreground</c> (PZ-28): the names of the processes under the app in front, such as a
/// terminal's shells and what runs in them. Names only: no arguments leave the helper.
/// </summary>
public sealed class ProcessController(IProcessTable table)
{
    public const int MaxNames = 64;
    private const int MaxDepth = 6;
    private static readonly string[] Interpreters = { "node", "python", "pythonw", "python3", "bun", "deno", "ruby" };

    public JsonObject Foreground()
    {
        var names = table.FrontProcessId() is { } root ? DescendantNames(root) : new List<string>();
        return new JsonObject { ["names"] = new JsonArray(names.Select(n => (JsonNode?)JsonValue.Create(n)).ToArray()) };
    }

    /// <summary>Breadth-first under <paramref name="root"/>, lower case without ".exe", each name once.</summary>
    private List<string> DescendantNames(int root)
    {
        var children = table.Rows().Where(r => r.Pid != r.ParentPid).ToLookup(r => r.ParentPid);
        var names = new List<string>();
        var visited = new HashSet<int> { root };
        var level = new List<int> { root };
        for (var depth = 0; depth < MaxDepth && level.Count > 0; depth++)
        {
            var next = new List<int>();
            foreach (var child in level.SelectMany(pid => children[pid]))
            {
                // A parent id can belong to a program that has ended, so loops are possible.
                if (!visited.Add(child.Pid)) continue;
                next.Add(child.Pid);
                var name = Bare(child.Name);
                if (Interpreters.Contains(name) && table.CommandLine(child.Pid) is { } line && ScriptName(line) is { } script)
                    name = script;
                if (name.Length > 64) name = name[..64];
                if (name.Length > 0 && names.Count < MaxNames && !names.Contains(name)) names.Add(name);
            }
            level = next;
        }
        return names;
    }

    private static string Bare(string name)
    {
        var lower = name.ToLowerInvariant();
        return lower.EndsWith(".exe", StringComparison.Ordinal) ? lower[..^4] : lower;
    }

    /// <summary>
    /// The tool an interpreter is running: for a script installed by a package manager, the
    /// package's name (without a "-cli", "-code" or "-ai" ending); otherwise the script's file name.
    /// </summary>
    public static string? ScriptName(string commandLine)
    {
        var script = Split(commandLine).Skip(1).FirstOrDefault(arg => !arg.StartsWith('-'));
        if (script is null) return null;
        var parts = script.Split(new[] { '\\', '/' }, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return null;
        var modules = Array.FindLastIndex(parts, p => p.Equals("node_modules", StringComparison.OrdinalIgnoreCase));
        if (modules >= 0 && modules + 1 < parts.Length && parts[modules + 1] != ".bin")
        {
            var package = parts[modules + 1];
            if (package.StartsWith('@') && modules + 2 < parts.Length) package = parts[modules + 2];
            package = package.ToLowerInvariant();
            foreach (var ending in new[] { "-cli", "-code", "-ai" })
            {
                if (package.Length > ending.Length && package.EndsWith(ending, StringComparison.Ordinal))
                    return package[..^ending.Length];
            }
            return package;
        }
        var file = parts[^1];
        var dot = file.LastIndexOf('.');
        var name = (dot > 0 ? file[..dot] : file).ToLowerInvariant();
        return name.Length == 0 ? null : name;
    }

    /// <summary>Splits a command line on spaces, keeping quoted parts together.</summary>
    public static IReadOnlyList<string> Split(string commandLine)
    {
        var parts = new List<string>();
        var current = new StringBuilder();
        var quoted = false;
        foreach (var c in commandLine)
        {
            if (c == '"') quoted = !quoted;
            else if (!quoted && char.IsWhiteSpace(c))
            {
                if (current.Length > 0) parts.Add(current.ToString());
                current.Clear();
            }
            else current.Append(c);
        }
        if (current.Length > 0) parts.Add(current.ToString());
        return parts;
    }
}

/// <summary>An app: its program file name (<c>chrome.exe</c>), which is its id on Windows, and the name shown for it.</summary>
public sealed record InstalledApp(string Id, string Name);

public interface IAppActivator
{
    /// <summary>Brings a window of the program forward. False when it is not running or Windows refused.</summary>
    bool Activate(string processName);
}

public interface IInstalledApps
{
    /// <summary>Every shortcut found: the program it starts and the shortcut's name. Unsorted, with repeats.</summary>
    IEnumerable<InstalledApp> List();
}

public static class AppCatalog
{
    public const int MaxApps = 5000;

    /// <summary>One entry per program, by name, without uninstallers or shortcuts to documents.</summary>
    public static JsonObject Result(IEnumerable<InstalledApp> found)
    {
        var apps = found
            .Where(a => a.Id.Length is > 4 and <= 255 && a.Id.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            .Where(a => a.Name.Trim().Length > 0)
            .Where(a => !a.Id.StartsWith("unins", StringComparison.OrdinalIgnoreCase) && !a.Name.Contains("uninstall", StringComparison.OrdinalIgnoreCase))
            // The shortest name for a program is its own; longer ones are "Name (safe mode)" and the like.
            .GroupBy(a => a.Id, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.OrderBy(a => a.Name.Length).ThenBy(a => a.Name, StringComparer.OrdinalIgnoreCase).First())
            .OrderBy(a => a.Name, StringComparer.OrdinalIgnoreCase)
            .Take(MaxApps);
        return new JsonObject
        {
            ["apps"] = new JsonArray(apps.Select(a => (JsonNode?)new JsonObject
            {
                ["bundleId"] = a.Id,
                ["name"] = a.Name.Trim().Length > 200 ? a.Name.Trim()[..200] : a.Name.Trim(),
            }).ToArray()),
        };
    }
}
