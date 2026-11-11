import ApplicationServices
import Foundation

/// Electron and Chromium apps build their Accessibility tree only when asked. Setting
/// `AXManualAccessibility` on the app asks for it, so the focused field's text can be read.
/// Done once per process, only for apps built on Electron or Chromium.
public final class ChromiumAccessibility: @unchecked Sendable {
    // @unchecked: `enabled` is only touched under `lock`.
    public static let shared = ChromiumAccessibility()

    /// How long the app gets to build its tree after being asked, the first time.
    public static let settleSeconds = 0.3

    private let lock = NSLock()
    private var enabled = Set<pid_t>()

    /// Framework folder names that mark an app as Electron or Chromium.
    static let frameworkNames: Set<String> = [
        "Electron Framework.framework",
        "Chromium Framework.framework",
        "Google Chrome Framework.framework",
        "Google Chrome Beta Framework.framework",
        "Google Chrome Canary Framework.framework",
        "Microsoft Edge Framework.framework",
        "Brave Browser Framework.framework",
        "Vivaldi Framework.framework",
    ]

    /// True when one of the bundle's frameworks is Electron's or a Chromium browser's.
    public static func isChromium(frameworks: [String]) -> Bool {
        frameworks.contains { frameworkNames.contains($0) }
    }

    static func isChromium(bundleURL: URL?) -> Bool {
        guard let bundleURL else { return false }
        let folder = bundleURL.appendingPathComponent("Contents/Frameworks")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        return isChromium(frameworks: names)
    }

    /// Asks a Chromium app for its tree the first time it is seen. Returns true when it was
    /// just asked, so the caller can give it a moment before reading.
    public func enableIfNeeded(pid: pid_t, bundleURL: URL?) -> Bool {
        lock.lock()
        let seen = enabled.contains(pid)
        if !seen { enabled.insert(pid) }
        lock.unlock()
        guard !seen, Self.isChromium(bundleURL: bundleURL) else { return false }
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        return AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue) == .success
    }
}
