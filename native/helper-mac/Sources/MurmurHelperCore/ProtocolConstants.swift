/// Constants that must match the TypeScript side. A test in `packages/shared`
/// reads this file and fails if `protocolVersion` drifts from `PROTOCOL_VERSION`.
public enum ProtocolConstants {
    /// Integer protocol version. Changes only for breaking protocol changes.
    public static let protocolVersion = 1

    /// Version of this helper build, reported in the `hello` event.
    public static let helperVersion = "0.1.0"

    /// Capabilities this build announces in `hello`. Main checks them before using a feature.
    public static let capabilities = [
        "permissions.check", "hotkey.hold", "audio.capture", "audio.silent-warning", "transcribe.whisperkit", "transcribe.file",
        "insert.paste", "insert.keystrokes", "insert.press-enter", "media.mute", "context.snapshot", "transcribe.prompt", "audio.hotplug", "hotkey.mouse", "typing.watch", "media.playback", "edits.watch",
    ]

    /// Longest accepted line in bytes, terminator excluded (1 MiB).
    public static let maxLineBytes = 1_048_576
}
