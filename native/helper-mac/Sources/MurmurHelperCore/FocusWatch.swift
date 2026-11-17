import AppKit
import Foundation

/// The app in front: its bundle id, its name and its process id.
public struct FrontAppInfo: Equatable, Sendable {
    public let bundleId: String?
    public let name: String?
    public let pid: Int?

    public init(bundleId: String?, name: String?, pid: Int?) {
        self.bundleId = bundleId
        self.name = name
        self.pid = pid
    }

    var payload: [String: JSONValue] {
        [
            "bundleId": bundleId.map { .string(String($0.prefix(255))) } ?? .null,
            "name": name.map { .string(String($0.prefix(200))) } ?? .null,
            "pid": pid.map { .int($0) } ?? .null,
        ]
    }
}

/// An installed app: its bundle id and the name shown for it.
public struct InstalledApp: Equatable, Sendable {
    public let bundleId: String
    public let name: String

    public init(bundleId: String, name: String) {
        self.bundleId = bundleId
        self.name = name
    }
}

/// Where the app in front and the installed apps come from. Tests use a fake.
public protocol AppsSource: Sendable {
    func frontApp() -> FrontAppInfo?
    func installedApps() -> [InstalledApp]
}

/// `focus.watch` and `apps.list` (RW-18, RW-19). While watching, the app in front is checked
/// four times a second on a background thread and sent as `focus.app` only when it changes
/// (and once when watching starts). Main decides what is blocked. The helper's main thread
/// reads stdin, so it has no run loop for workspace notifications; the check is a cheap
/// Accessibility call.
public final class FocusWatchController: @unchecked Sendable {
    // @unchecked: `generation` is only touched under `lock`.
    private let source: any AppsSource
    private let emit: @Sendable (Envelope) -> Void
    private let pollSeconds: Double
    private let lock = NSLock()
    private var generation = 0

    static let maxApps = 5000

    public init(source: any AppsSource, emit: @escaping @Sendable (Envelope) -> Void, pollSeconds: Double = 0.25) {
        self.source = source
        self.emit = emit
        self.pollSeconds = pollSeconds
    }

    public func handle(id: String, type: String, payload: [String: JSONValue]) -> Envelope {
        switch type {
        case "focus.watch":
            guard let enabled = payload["enabled"]?.boolValue else {
                return MessageRouter.failure(id: id, requestType: type, .invalidPayload, "focus.watch needs enabled")
            }
            let token = lock.withLock { () -> Int in
                generation += 1
                return generation
            }
            if enabled {
                let thread = Thread { [weak self] in self?.watch(token: token) }
                thread.start()
            }
            return MessageRouter.success(id: id, requestType: type, ["watching": .bool(enabled)])
        case "apps.list":
            let apps = Self.sorted(source.installedApps()).prefix(Self.maxApps)
            return MessageRouter.success(
                id: id, requestType: type,
                [
                    "apps": .array(
                        apps.map { .object(["bundleId": .string($0.bundleId), "name": .string($0.name)]) })
                ])
        default:
            return MessageRouter.failure(id: id, requestType: type, .unsupportedRequest, "Unknown request type")
        }
    }

    /// One entry per bundle id, by name.
    static func sorted(_ apps: [InstalledApp]) -> [InstalledApp] {
        var seen = Set<String>()
        let unique = apps.filter { app in
            guard !app.bundleId.isEmpty, !app.name.isEmpty, !seen.contains(app.bundleId) else { return false }
            seen.insert(app.bundleId)
            return true
        }
        return unique.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func isCurrent(_ token: Int) -> Bool { lock.withLock { generation == token } }

    private func watch(token: Int) {
        var last: FrontAppInfo?
        var first = true
        while isCurrent(token) {
            let now = source.frontApp()
            if first || now != last, let now {
                guard isCurrent(token) else { return }
                emit(Envelope(id: nil, type: "focus.app", payload: now.payload))
                last = now
                first = false
            }
            Thread.sleep(forTimeInterval: pollSeconds)
        }
    }
}

/// The real source: the focused app through Accessibility (falling back to the window list),
/// and the apps in the usual Applications folders.
public struct SystemAppsSource: AppsSource {
    public init() {}

    public func frontApp() -> FrontAppInfo? {
        guard let app = Frontmost.application() else { return nil }
        return FrontAppInfo(
            bundleId: app.bundleIdentifier, name: app.localizedName, pid: Int(app.processIdentifier))
    }

    public func installedApps() -> [InstalledApp] {
        let manager = FileManager.default
        var folders = [
            URL(fileURLWithPath: "/Applications"),
            URL(fileURLWithPath: "/Applications/Utilities"),
            URL(fileURLWithPath: "/System/Applications"),
            URL(fileURLWithPath: "/System/Applications/Utilities"),
        ]
        folders.append(manager.homeDirectoryForCurrentUser.appendingPathComponent("Applications"))
        var apps: [InstalledApp] = []
        for folder in folders {
            guard let items = try? manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) else {
                continue
            }
            for item in items where item.pathExtension == "app" {
                guard let bundle = Bundle(url: item), let id = bundle.bundleIdentifier else { continue }
                let name =
                    (bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
                    ?? (bundle.object(forInfoDictionaryKey: "CFBundleName") as? String)
                    ?? item.deletingPathExtension().lastPathComponent
                apps.append(InstalledApp(bundleId: id, name: name))
            }
        }
        return apps
    }
}
