import Foundation

public enum HostInfo {
    /// The `macos` object of the `hello` payload.
    public static func macOS() -> [String: JSONValue] {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        #if arch(arm64)
        let arch = "arm64"
        #elseif arch(x86_64)
        let arch = "x86_64"
        #else
        let arch = "unknown"
        #endif
        return [
            "version": .string("\(version.majorVersion).\(version.minorVersion)"),
            "arch": .string(arch),
        ]
    }

    /// Milliseconds since `start`, from the system uptime clock.
    public static func uptimeProvider() -> @Sendable () -> Int {
        let start = ProcessInfo.processInfo.systemUptime
        return { Int((ProcessInfo.processInfo.systemUptime - start) * 1000) }
    }
}
