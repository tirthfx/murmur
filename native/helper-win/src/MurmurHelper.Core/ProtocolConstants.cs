namespace Murmur.Helper;

/// <summary>
/// Constants that must match the TypeScript side. A test in <c>packages/shared</c> reads this
/// file and fails if <see cref="ProtocolVersion"/> drifts from <c>PROTOCOL_VERSION</c>.
/// </summary>
public static class ProtocolConstants
{
    /// <summary>Integer protocol version. Changes only for breaking protocol changes.</summary>
    public const int ProtocolVersion = 1;

    /// <summary>Version of this helper build, reported in the hello event.</summary>
    public const string HelperVersion = "0.1.0";

    /// <summary>Longest accepted line in bytes, terminator excluded (1 MiB).</summary>
    public const int MaxLineBytes = 1_048_576;
}
