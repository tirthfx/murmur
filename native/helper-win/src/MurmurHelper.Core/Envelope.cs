using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Murmur.Helper;

/// <summary>One protocol message: <c>{id, type, payload}</c>. The id is null for events.</summary>
public sealed record Envelope(string? Id, string Type, JsonObject Payload)
{
    public string Encode()
    {
        var root = new JsonObject
        {
            ["id"] = Id is null ? null : JsonValue.Create(Id),
            ["type"] = Type,
            ["payload"] = JsonNode.Parse(Payload.ToJsonString()),
        };
        return root.ToJsonString(new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
    }
}

/// <summary>The result of reading one line.</summary>
public abstract record Decoded
{
    public sealed record Ok(Envelope Envelope) : Decoded;
    public sealed record Malformed : Decoded;
    /// <summary>Valid JSON that is not an envelope. The id and type are kept when they can be read.</summary>
    public sealed record Invalid(string Reason, string? Id, string? Type) : Decoded;
}

public static class EnvelopeCodec
{
    private static readonly string[] Keys = { "id", "type", "payload" };

    public static Decoded Decode(string line)
    {
        JsonNode? node;
        try
        {
            node = JsonNode.Parse(line);
        }
        catch (JsonException)
        {
            return new Decoded.Malformed();
        }
        if (node is not JsonObject root) return new Decoded.Invalid("Envelope must be a JSON object", null, null);

        string? id = root["id"] is JsonValue idValue && idValue.TryGetValue<string>(out var idText) ? idText : null;
        string? type = root["type"] is JsonValue typeValue && typeValue.TryGetValue<string>(out var typeText) ? typeText : null;

        foreach (var key in root.Select(pair => pair.Key))
        {
            if (!Keys.Contains(key)) return new Decoded.Invalid($"Unknown envelope field \"{key}\"", id, type);
        }
        if (!root.ContainsKey("id") || (root["id"] is not null && id is null))
            return new Decoded.Invalid("id must be a string or null", id, type);
        if (string.IsNullOrEmpty(type)) return new Decoded.Invalid("type must be a non-empty string", id, type);
        if (root["payload"] is not JsonObject payload) return new Decoded.Invalid("payload must be an object", id, type);
        return new Decoded.Ok(new Envelope(id, type, payload));
    }
}

/// <summary>Error codes the helper sends. Names and retryability follow the protocol spec.</summary>
public static class ErrorCode
{
    public const string HandshakeRequired = "HANDSHAKE_REQUIRED";
    public const string ProtocolVersionMismatch = "PROTOCOL_VERSION_MISMATCH";
    public const string UnsupportedRequest = "UNSUPPORTED_REQUEST";
    public const string InvalidPayload = "INVALID_PAYLOAD";
    public const string PermissionDenied = "PERMISSION_DENIED";
    public const string Conflict = "CONFLICT";
    public const string NotFound = "NOT_FOUND";
    public const string Busy = "BUSY";
    public const string DeviceNotFound = "DEVICE_NOT_FOUND";
    public const string AudioEngineFailed = "AUDIO_ENGINE_FAILED";
    public const string PasteFailed = "PASTE_FAILED";
    public const string KeychainFailed = "KEYCHAIN_FAILED";
    public const string Internal = "INTERNAL";

    private static readonly HashSet<string> RetryableCodes = new()
    {
        Internal, Busy, AudioEngineFailed, PasteFailed, KeychainFailed,
    };

    public static bool Retryable(string code) => RetryableCodes.Contains(code);
}

/// <summary>A request that cannot be done. The router turns it into an error response.</summary>
public sealed class HelperException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>Reads typed values out of a request payload, refusing what is missing or the wrong type.</summary>
public static class Payload
{
    public static string Str(JsonObject p, string key) =>
        TryStr(p, key) ?? throw new HelperException(ErrorCode.InvalidPayload, $"{key} must be a string");

    public static string? TryStr(JsonObject p, string key) =>
        p[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    public static bool Bool(JsonObject p, string key) =>
        TryBool(p, key) ?? throw new HelperException(ErrorCode.InvalidPayload, $"{key} must be a boolean");

    public static bool? TryBool(JsonObject p, string key) =>
        p[key] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : null;

    public static int Int(JsonObject p, string key) =>
        TryInt(p, key) ?? throw new HelperException(ErrorCode.InvalidPayload, $"{key} must be an integer");

    public static int? TryInt(JsonObject p, string key)
    {
        if (p[key] is not JsonValue v) return null;
        if (v.TryGetValue<int>(out var i)) return i;
        return v.TryGetValue<double>(out var d) && d == Math.Floor(d) && Math.Abs(d) < int.MaxValue ? (int)d : null;
    }

    public static IReadOnlyList<string> Strings(JsonObject p, string key) =>
        p[key] is JsonArray array
            ? array.Select(item => item is JsonValue v && v.TryGetValue<string>(out var s)
                ? s : throw new HelperException(ErrorCode.InvalidPayload, $"{key} must hold strings")).ToList()
            : Array.Empty<string>();

    public static string Utf8(ReadOnlySpan<byte> bytes) => Encoding.UTF8.GetString(bytes);
}
