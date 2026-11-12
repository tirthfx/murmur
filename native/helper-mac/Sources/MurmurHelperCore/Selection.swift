import CryptoKit
import Foundation

/// What Accessibility says about the selection in the focused element.
public enum AXSelection: Sendable, Equatable {
    /// No focused element.
    case noFocus
    /// A password field. Nothing was read.
    case secure
    /// The element does not report a selection.
    case unsupported
    /// The selection. `text` is nil when it was over the limit and so not read.
    case selected(text: String?, location: Int?, length: Int)
}

/// Reads the selection. The system one uses Accessibility; tests use a fake.
public protocol SelectionReader: Sendable {
    /// Must not read text from a secure field, nor text longer than `maxLength` UTF-16 units.
    func read(maxLength: Int) -> AXSelection
}

/// The answer to `selection.read`.
public struct SelectionOutcome: Sendable, Equatable {
    public enum Status: String, Sendable { case ok, empty, tooLong = "too_long", secure, unavailable }
    public enum Source: String, Sendable { case ax, clipboard }

    public var status: Status
    public var text: String = ""
    public var length: Int = 0
    public var range: (location: Int, length: Int)?
    public var source: Source?

    public static func == (a: SelectionOutcome, b: SelectionOutcome) -> Bool {
        a.status == b.status && a.text == b.text && a.length == b.length && a.source == b.source
            && a.range?.location == b.range?.location && a.range?.length == b.range?.length
    }

    /// SHA-256 of the UTF-8 text, lower-case hex; empty unless `ok`.
    public var hash: String {
        guard status == .ok else { return "" }
        return SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// The pure steps of reading a selection, with the clipboard copy and waiting injected.
public struct SelectionReading: Sendable {
    public static let maxLength = 8_000
    /// How often the pasteboard is checked while waiting for a copy.
    static let pollSeconds = 0.02
    /// Virtual key code of C.
    static let keyC: UInt16 = 8

    let reader: any SelectionReader
    let pasteboard: any PasteboardAccess
    let keys: any KeyPoster
    let sleep: @Sendable (Double) async -> Void

    public init(
        reader: any SelectionReader, pasteboard: any PasteboardAccess, keys: any KeyPoster,
        sleep: @escaping @Sendable (Double) async -> Void
    ) {
        self.reader = reader
        self.pasteboard = pasteboard
        self.keys = keys
        self.sleep = sleep
    }

    public func read(fallback: Bool, clipboardFirst: Bool, copyWait: Double) async -> SelectionOutcome {
        let ax = reader.read(maxLength: Self.maxLength)
        // A password field is never copied either.
        if ax == .secure { return SelectionOutcome(status: .secure) }
        if fallback, clipboardFirst { return await copy(wait: copyWait) }
        switch ax {
        case .selected(let text, let location, let length):
            let range = location.map { (location: $0, length: length) }
            if length > Self.maxLength || (text?.utf16.count ?? 0) > Self.maxLength {
                return SelectionOutcome(status: .tooLong, length: max(length, text?.utf16.count ?? 0), range: range)
            }
            guard let text else {
                // A range but no text: the element would not say, so copy it.
                if length > 0 { return fallback ? await copy(wait: copyWait) : SelectionOutcome(status: .unavailable) }
                return SelectionOutcome(status: .empty, range: range)
            }
            guard !text.isEmpty else { return SelectionOutcome(status: .empty, range: range) }
            return SelectionOutcome(status: .ok, text: text, length: text.utf16.count, range: range, source: .ax)
        case .noFocus, .unsupported:
            return fallback ? await copy(wait: copyWait) : SelectionOutcome(status: .unavailable)
        case .secure:
            return SelectionOutcome(status: .secure)
        }
    }

    /// Command+C, wait for the pasteboard to change, read it, put the old contents back.
    /// An unchanged pasteboard means nothing was selected (or the app does not copy).
    func copy(wait: Double) async -> SelectionOutcome {
        let saved = pasteboard.snapshot()
        let before = pasteboard.changeCount
        guard keys.postKey(Self.keyC, modifiers: .command) else { return SelectionOutcome(status: .unavailable) }
        var waited = 0.0
        while pasteboard.changeCount == before, waited < wait {
            await sleep(Self.pollSeconds)
            waited += Self.pollSeconds
        }
        let after = pasteboard.changeCount
        guard after != before else { return SelectionOutcome(status: .empty) }
        let text = pasteboard.readString() ?? ""
        // Put back what the user had, unless something else wrote in the meantime.
        if pasteboard.changeCount == after { pasteboard.restore(saved) }
        let length = text.utf16.count
        if length > Self.maxLength { return SelectionOutcome(status: .tooLong, length: length) }
        if text.isEmpty { return SelectionOutcome(status: .empty) }
        return SelectionOutcome(status: .ok, text: text, length: length, source: .clipboard)
    }
}

/// `selection.read`. Answered later through `reply`, since Accessibility and the copy take a
/// moment. One read at a time.
public final class SelectionController: @unchecked Sendable {
    // @unchecked: `busy` is read and written only while `lock` is held.
    private let lock = NSLock()
    private var busy = false

    private let reading: SelectionReading
    private let permissions: any PermissionProvider
    private let frontmostBundleId: @Sendable () -> String?
    private let reply: @Sendable (Envelope) -> Void

    public init(
        reading: SelectionReading, permissions: any PermissionProvider,
        frontmostBundleId: @escaping @Sendable () -> String?, reply: @escaping @Sendable (Envelope) -> Void
    ) {
        self.reading = reading
        self.permissions = permissions
        self.frontmostBundleId = frontmostBundleId
        self.reply = reply
    }

    public func handle(id: String, payload: [String: JSONValue]) -> Envelope? {
        let type = "selection.read"
        let fallback = payload["clipboardFallback"]?.boolValue ?? true
        let waitMs = payload["copyWaitMs"]?.intValue ?? 250
        guard (50...1_000).contains(waitMs) else {
            return MessageRouter.failure(id: id, requestType: type, .invalidPayload, "copyWaitMs must be from 50 to 1000")
        }
        let firstApps = InsertionController.strings(payload["clipboardFirstInApps"])
        // Reading another app's selection, and pressing Command+C, need Accessibility.
        guard permissions.status(of: .accessibility) == .granted else {
            return MessageRouter.failure(
                id: id, requestType: type, .permissionDenied, "accessibility: Accessibility is not granted")
        }
        let claimed = lock.withLock { () -> Bool in
            if busy { return false }
            busy = true
            return true
        }
        guard claimed else {
            return MessageRouter.failure(id: id, requestType: type, .busy, "Another selection read is running")
        }
        let bundle = frontmostBundleId()
        let reading = self.reading
        Task {
            let outcome = await reading.read(
                fallback: fallback, clipboardFirst: bundle.map(firstApps.contains) ?? false,
                copyWait: Double(waitMs) / 1000)
            lock.withLock { busy = false }
            reply(MessageRouter.success(id: id, requestType: type, Self.result(outcome, bundle: bundle)))
        }
        return nil
    }

    static func result(_ outcome: SelectionOutcome, bundle: String?) -> [String: JSONValue] {
        [
            "status": .string(outcome.status.rawValue),
            "text": .string(outcome.status == .ok ? outcome.text : ""),
            "length": .int(outcome.length),
            "range": outcome.range.map { .object(["location": .int($0.location), "length": .int($0.length)]) } ?? .null,
            "hash": .string(outcome.hash),
            "source": outcome.status == .ok ? outcome.source.map { .string($0.rawValue) } ?? .null : .null,
            "appBundleId": bundle.map { .string($0) } ?? .null,
        ]
    }
}
