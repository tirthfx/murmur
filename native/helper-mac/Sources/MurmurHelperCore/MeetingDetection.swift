import AppKit
import Foundation

/// How to tell that one call app has a call going (NT-01). Main sends these with
/// `detect.subscribe`; they are data, so they can change without a new helper.
public struct DetectMatcher: Equatable, Sendable {
    public struct Native: Equatable, Sendable {
        public let bundleIds: [String]
        public let titles: [String]
    }
    public struct Web: Equatable, Sendable {
        public let hosts: [String]
        public let path: String?
        public let titles: [String]?
    }

    public let id: String
    public let native: Native?
    public let web: Web?

    public init(id: String, native: Native?, web: Web?) {
        self.id = id
        self.native = native
        self.web = web
    }

    static func strings(_ value: JSONValue?) -> [String]? {
        guard case .array(let items)? = value else { return nil }
        let texts = items.compactMap { $0.stringValue }
        return texts.count == items.count ? texts : nil
    }

    /// nil when the value is not a matcher the helper can use.
    static func parse(_ value: JSONValue) -> DetectMatcher? {
        guard case .object(let object) = value, let id = object["id"]?.stringValue, !id.isEmpty else { return nil }
        var native: Native?
        if case .object(let fields)? = object["native"] {
            guard let ids = strings(fields["bundleIds"]), let titles = strings(fields["titles"]) else { return nil }
            native = Native(bundleIds: ids, titles: titles)
        }
        var web: Web?
        if case .object(let fields)? = object["web"] {
            guard let hosts = strings(fields["hosts"]) else { return nil }
            var path: String?
            if let text = fields["path"]?.stringValue {
                guard (try? NSRegularExpression(pattern: text)) != nil else { return nil }
                path = text
            }
            web = Web(hosts: hosts.map { $0.lowercased() }, path: path, titles: strings(fields["titles"]))
        }
        guard native != nil || web != nil else { return nil }
        return DetectMatcher(id: id, native: native, web: web)
    }
}

/// A running app, by bundle id and process id.
public struct DetectApp: Hashable, Sendable {
    public let bundleId: String
    public let pid: Int
    public init(bundleId: String, pid: Int) {
        self.bundleId = bundleId
        self.pid = pid
    }
}

/// One window of an app: its title, and for a browser the address of the tab it shows.
public struct DetectWindow: Equatable, Sendable {
    public let title: String?
    public let address: String?
    public init(title: String?, address: String?) {
        self.title = title
        self.address = address
    }
}

/// Where running apps and their windows come from. Tests use a fake.
public protocol DetectSource: Sendable {
    func runningApps() -> [DetectApp]
    /// `readPages` asks for the address of the visible tab too (browsers only).
    func windows(of app: DetectApp, readPages: Bool) -> [DetectWindow]
}

/// `detect.subscribe` (NT-01). While subscribed, a background thread looks every 2 seconds at
/// the windows of the apps the matchers name and sends `detect.event` when a call starts or
/// ends for a matcher. A browser's visible tab is the only one it can see, so a call in a
/// background tab never matches. Window titles and addresses are read here and never sent.
public final class DetectionController: @unchecked Sendable {
    // @unchecked: `generation` is only touched under `lock`.
    private let source: any DetectSource
    private let emit: @Sendable (Envelope) -> Void
    private let pollSeconds: Double
    private let lock = NSLock()
    private var generation = 0

    static let maxMatchers = 20

    public init(
        source: any DetectSource, emit: @escaping @Sendable (Envelope) -> Void, pollSeconds: Double = 2
    ) {
        self.source = source
        self.emit = emit
        self.pollSeconds = pollSeconds
    }

    public func handle(id: String, type: String, payload: [String: JSONValue]) -> Envelope {
        guard type == "detect.subscribe" else {
            return MessageRouter.failure(id: id, requestType: type, .unsupportedRequest, "Unknown request type")
        }
        guard let enabled = payload["enabled"]?.boolValue, case .array(let raw)? = payload["matchers"],
            raw.count <= Self.maxMatchers
        else {
            return MessageRouter.failure(
                id: id, requestType: type, .invalidPayload, "detect.subscribe needs enabled and matchers")
        }
        let matchers = raw.compactMap(DetectMatcher.parse)
        guard matchers.count == raw.count else {
            return MessageRouter.failure(id: id, requestType: type, .invalidPayload, "A matcher is not valid")
        }
        let token = lock.withLock { () -> Int in
            generation += 1
            return generation
        }
        if enabled && !matchers.isEmpty {
            let thread = Thread { [weak self] in self?.watch(token: token, matchers: matchers) }
            thread.start()
        }
        return MessageRouter.success(
            id: id, requestType: type, ["watching": .bool(enabled && !matchers.isEmpty)])
    }

    private func isCurrent(_ token: Int) -> Bool { lock.withLock { generation == token } }

    /// The ids of the matchers that have a call going now.
    func active(_ matchers: [DetectMatcher]) -> Set<String> {
        let apps = source.runningApps()
        var cache: [DetectApp: [DetectWindow]] = [:]
        func windows(_ app: DetectApp, pages: Bool) -> [DetectWindow] {
            if let known = cache[app], !pages || known.contains(where: { $0.address != nil }) { return known }
            let read = source.windows(of: app, readPages: pages)
            cache[app] = read
            return read
        }
        var result = Set<String>()
        for matcher in matchers {
            if let native = matcher.native {
                for app in apps where native.bundleIds.contains(app.bundleId) {
                    let wanted = native.titles.map { $0.lowercased() }
                    if windows(app, pages: false).contains(where: { Self.title($0.title, hasAny: wanted) }) {
                        result.insert(matcher.id)
                    }
                }
            }
            if let web = matcher.web {
                for app in apps where SystemAppsSource.browsers.contains(app.bundleId) {
                    if windows(app, pages: true).contains(where: { Self.matches(web, $0) }) {
                        result.insert(matcher.id)
                    }
                }
            }
        }
        return result
    }

    static func title(_ title: String?, hasAny words: [String]) -> Bool {
        guard let lower = title?.lowercased() else { return false }
        return words.contains { lower.contains($0) }
    }

    /// A browser window matches when its visible tab is on one of the hosts, the path fits
    /// and the title has a word (when asked for). Where the address cannot be read the title
    /// alone decides, but only for a matcher that has title words.
    static func matches(_ web: DetectMatcher.Web, _ window: DetectWindow) -> Bool {
        let titleOk = web.titles.map { title(window.title, hasAny: $0.map { $0.lowercased() }) } ?? true
        guard let address = window.address else { return web.titles != nil && titleOk }
        guard let site = SiteInfo.from(address: address), web.hosts.contains(site.host) else { return false }
        if let path = web.path {
            guard let expression = try? NSRegularExpression(pattern: path) else { return false }
            let range = NSRange(site.path.startIndex..., in: site.path)
            if expression.firstMatch(in: site.path, range: range) == nil { return false }
        }
        return titleOk
    }

    private func watch(token: Int, matchers: [DetectMatcher]) {
        var last = Set<String>()
        while isCurrent(token) {
            let now = active(matchers)
            for matcher in matchers {
                let was = last.contains(matcher.id)
                let is_ = now.contains(matcher.id)
                guard was != is_, isCurrent(token) else { continue }
                emit(Envelope(id: nil, type: "detect.event", payload: ["matcherId": .string(matcher.id), "active": .bool(is_)]))
            }
            last = now
            Thread.sleep(forTimeInterval: pollSeconds)
        }
    }
}

/// The real source: running apps from the workspace, their windows through Accessibility.
public struct SystemDetectSource: DetectSource {
    public init() {}

    public func runningApps() -> [DetectApp] {
        NSWorkspace.shared.runningApplications.compactMap { app in
            guard let id = app.bundleIdentifier else { return nil }
            return DetectApp(bundleId: id, pid: Int(app.processIdentifier))
        }
    }

    public func windows(of app: DetectApp, readPages: Bool) -> [DetectWindow] {
        let element = AXUIElementCreateApplication(pid_t(app.pid))
        AXUIElementSetMessagingTimeout(element, 0.25)
        if readPages {
            let running = NSRunningApplication(processIdentifier: pid_t(app.pid))
            if ChromiumAccessibility.shared.enableIfNeeded(pid: pid_t(app.pid), bundleURL: running?.bundleURL) {
                Thread.sleep(forTimeInterval: ChromiumAccessibility.settleSeconds)
            }
        }
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as CFString, &value) == .success,
            let list = value as? [AXUIElement]
        else { return [] }
        return list.map { window in
            var title: CFTypeRef?
            AXUIElementCopyAttributeValue(window, kAXTitleAttribute as CFString, &title)
            let address = readPages ? SystemAppsSource.pageAddress(in: window) : nil
            return DetectWindow(title: title as? String, address: address)
        }
    }
}
