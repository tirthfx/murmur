import Foundation

/// Diagnostics go to stderr only. stdout is reserved for protocol messages.
public enum Log {
    public static func info(_ message: String) {
        FileHandle.standardError.write(Data("[murmur-helper] \(message)\n".utf8))
    }
}
