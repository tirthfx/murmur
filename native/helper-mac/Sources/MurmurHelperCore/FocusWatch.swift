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
}

/// The page open in a browser: its host and path only. The scheme, query and fragment are
/// dropped in the helper, so they never leave it.
public struct SiteInfo: Equatable, Sendable {
    public let host: String
    public let path: String

    public init(host: String, path: String) {
        self.host = host
        self.path = path
    }

    /// Host (lower case) and path of an http or https address; nil for anything else.
    public static func from(address: String) -> SiteInfo? {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
            let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
            let host = url.host?.lowercased(), !host.isEmpty
        else { return nil }
        let path = url.path.isEmpty ? "/" : url.path
        return SiteInfo(host: String(host.prefix(253)), path: String(path.prefix(512)))
    }
}

/// What reading a browser's page gave.
public enum SiteRead: Equatable, Sendable {
    /// Not a browser Murmur knows: no site is read.
    case notBrowser
    /// A known browser whose page address could not be read.
    case unavailable
    /// A known browser: the page's site, or nil for a page that is not http or https.
    case site(SiteInfo?)
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

/// Where the app in front, its page and the installed apps come from. Tests use a fake.
public protocol AppsSource: Sendable {
    func frontApp() -> FrontAppInfo?
    /// The front window's title: a change means another tab or window, so the page is read
    /// again at once.
    func windowTitle(of app: FrontAppInfo) -> String?
    func site(of app: FrontAppInfo) -> SiteRead
    func installedApps() -> [InstalledApp]
}

/// `focus.watch` and `apps.list` (RW-18 to RW-20). While watching, the app in front is
/// checked four times a second on a background thread. In a known browser the page's host and
/// path are read too: when the window title changes and about every 2 seconds. `focus.app`
/// is sent only when something changed (and once when watching starts). Main decides what is
/// blocked. The helper's main thread reads stdin, so it has no run loop for workspace
/// notifications; the checks are Accessibility calls.
public final class FocusWatchController: @unchecked Sendable {
    // @unchecked: `generation` is only touched under `lock`.
    private let source: any AppsSource
    private let emit: @Sendable (Envelope) -> Void
    private let pollSeconds: Double
    private let sitePolls: Int
    private let lock = NSLock()
    private var generation = 0

    static let maxApps = 5000

    /// `sitePolls`: read the page every this many checks (8 × 0.25 s = 2 s).
    public init(
        source: any AppsSource, emit: @escaping @Sendable (Envelope) -> Void, pollSeconds: Double = 0.25,
        sitePolls: Int = 8
    ) {
        self.source = source
        self.emit = emit
        self.pollSeconds = pollSeconds
        self.sitePolls = sitePolls
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

    static func payload(_ app: FrontAppInfo, _ read: SiteRead) -> [String: JSONValue] {
        var result: [String: JSONValue] = [
            "bundleId": app.bundleId.map { .string(String($0.prefix(255))) } ?? .null,
            "name": app.name.map { .string(String($0.prefix(200))) } ?? .null,
            "pid": app.pid.map { .int($0) } ?? .null,
        ]
        switch read {
        case .notBrowser:
            result["siteStatus"] = .string("none")
            result["site"] = .null
        case .unavailable:
            result["siteStatus"] = .string("unavailable")
            result["site"] = .null
        case .site(let site):
            result["siteStatus"] = .string("ok")
            result["site"] = site.map { .object(["host": .string($0.host), "path": .string($0.path)]) } ?? .null
        }
        return result
    }

    private func isCurrent(_ token: Int) -> Bool { lock.withLock { generation == token } }

    private func watch(token: Int) {
        var lastApp: FrontAppInfo?
        var lastRead: SiteRead = .notBrowser
        var lastTitle: String?
        var polls = 0
        var first = true
        while isCurrent(token) {
            if let app = source.frontApp() {
                var read = lastRead
                var title = lastTitle
                let appChanged = first || app != lastApp
                if appChanged {
                    title = source.windowTitle(of: app)
                    read = source.site(of: app)
                    polls = 0
                } else if lastRead != .notBrowser {
                    polls += 1
                    title = source.windowTitle(of: app)
                    if title != lastTitle || polls >= sitePolls {
                        read = source.site(of: app)
                        polls = 0
                    }
                }
                if appChanged || read != lastRead {
                    guard isCurrent(token) else { return }
                    emit(Envelope(id: nil, type: "focus.app", payload: Self.payload(app, read)))
                }
                lastApp = app
                lastRead = read
                lastTitle = title
                first = false
            }
            Thread.sleep(forTimeInterval: pollSeconds)
        }
    }
}

/// The real source: the focused app through Accessibility (falling back to the window list),
/// the page address of known browsers through Accessibility, and the apps in the usual
/// Applications folders.
public struct SystemAppsSource: AppsSource {
    public init() {}

    /// Browsers whose page address Murmur tries to read (RW-20).
    public static let browsers: Set<String> = [
        "com.apple.Safari", "com.apple.SafariTechnologyPreview",
        "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.canary",
        "com.microsoft.edgemac", "com.brave.Browser", "company.thebrowser.Browser",
        "org.mozilla.firefox", "com.vivaldi.Vivaldi", "com.operasoftware.Opera", "org.chromium.Chromium",
    ]

    /// Most elements looked at to find the page in a window.
    static let maxNodes = 400

    public func frontApp() -> FrontAppInfo? {
        guard let app = Frontmost.application() else { return nil }
        return FrontAppInfo(
            bundleId: app.bundleIdentifier, name: app.localizedName, pid: Int(app.processIdentifier))
    }

    private func focusedWindow(pid: pid_t) -> AXUIElement? {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &value) == .success,
            let value, CFGetTypeID(value) == AXUIElementGetTypeID()
        else { return nil }
        return (value as! AXUIElement)
    }

    public func windowTitle(of app: FrontAppInfo) -> String? {
        guard let pid = app.pid, let window = focusedWindow(pid: pid_t(pid)) else { return nil }
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &value) == .success else {
            return nil
        }
        return value as? String
    }

    public func site(of app: FrontAppInfo) -> SiteRead {
        guard let bundleId = app.bundleId, Self.browsers.contains(bundleId), let pid = app.pid else {
            return .notBrowser
        }
        let running = NSRunningApplication(processIdentifier: pid_t(pid))
        if ChromiumAccessibility.shared.enableIfNeeded(pid: pid_t(pid), bundleURL: running?.bundleURL) {
            Thread.sleep(forTimeInterval: ChromiumAccessibility.settleSeconds)
        }
        guard let window = focusedWindow(pid: pid_t(pid)) else { return .unavailable }
        guard let address = Self.pageAddress(in: window) else { return .unavailable }
        return .site(SiteInfo.from(address: address))
    }

    /// The `AXURL` of the first web area under the window, breadth first, without going into
    /// web areas (their content is never read).
    static func pageAddress(in window: AXUIElement) -> String? {
        var queue: [AXUIElement] = [window]
        var seen = 0
        while !queue.isEmpty, seen < maxNodes {
            let element = queue.removeFirst()
            seen += 1
            var role: CFTypeRef?
            AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
            if (role as? String) == "AXWebArea" {
                var url: CFTypeRef?
                guard AXUIElementCopyAttributeValue(element, "AXURL" as CFString, &url) == .success, let url else {
                    continue
                }
                if CFGetTypeID(url) == CFURLGetTypeID() { return (url as! URL).absoluteString }
                if let text = url as? String { return text }
                continue
            }
            var children: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
                let list = children as? [AXUIElement]
            {
                queue.append(contentsOf: list)
            }
        }
        return nil
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
