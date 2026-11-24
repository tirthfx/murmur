using System.Text.RegularExpressions;
using Xunit;

namespace Murmur.Helper.Tests;

public class ProtocolConstantsTests
{
    [Fact]
    public void ProtocolVersionMatchesTheTypeScriptConstant()
    {
        var root = FindRepoRoot();
        var ts = File.ReadAllText(Path.Combine(root, "packages/shared/src/protocol-version.ts"));
        var match = Regex.Match(ts, @"PROTOCOL_VERSION\s*=\s*(\d+)");
        Assert.True(match.Success);
        Assert.Equal(ProtocolConstants.ProtocolVersion, int.Parse(match.Groups[1].Value));
    }

    internal static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "CLAUDE.md"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("repository root not found");
    }
}
