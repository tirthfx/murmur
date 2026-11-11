import Foundation

/// Everything on the pasteboard: each item with every type it carries (text, image, file...).
public struct PasteboardSnapshot: Sendable, Equatable {
    public var items: [[String: Data]]
    public init(items: [[String: Data]]) { self.items = items }
}

/// The system pasteboard, reduced to what insertion needs. Tests use a fake.
public protocol PasteboardAccess: Sendable {
    var changeCount: Int { get }
    func snapshot() -> PasteboardSnapshot
    /// Replaces the contents with plain text, marked so clipboard managers skip it.
    /// Returns the change count after writing.
    func writeTransientText(_ text: String) -> Int
    /// Replaces the contents with plain text the user keeps (copy last, copy fallback).
    func writeText(_ text: String)
    func restore(_ snapshot: PasteboardSnapshot)
}

/// Synthetic key events. Tests use a fake.
public protocol KeyPoster: Sendable {
    /// Posts Command+V. Returns false if the events could not be created or posted.
    func postPaste() -> Bool
    /// Posts the text as Unicode key events. Returns false on failure.
    func postText(_ chunk: String) -> Bool
    /// Posts one Return key press. Returns false on failure.
    func postReturn() -> Bool
}

public enum InsertMethod: String, Sendable {
    case auto
    case pasteCommandV = "paste_cmd_v"
    case keystrokes
}

public struct InsertOutcome: Sendable, Equatable {
    public var method: InsertMethod
    public var delivered: Bool
    /// nil when restoring was not asked for.
    public var clipboardRestored: Bool?
}

/// The pure steps of insertion, with waiting injected so tests run instantly.
public struct Inserter: Sendable {
    public static let chunkLimit = 20
    public static let keystrokeGap: Double = 0.004

    let pasteboard: any PasteboardAccess
    let keys: any KeyPoster
    let sleep: @Sendable (Double) async -> Void

    public init(pasteboard: any PasteboardAccess, keys: any KeyPoster, sleep: @escaping @Sendable (Double) async -> Void) {
        self.pasteboard = pasteboard
        self.keys = keys
        self.sleep = sleep
    }

    /// Saves the pasteboard, puts the text on it, pastes, waits, then restores the saved
    /// contents only if nothing else changed the pasteboard in the meantime.
    public func paste(_ text: String, restore: Bool, restoreDelay: Double) async -> InsertOutcome? {
        let saved = restore ? pasteboard.snapshot() : nil
        let written = pasteboard.writeTransientText(text)
        guard keys.postPaste() else {
            if let saved, pasteboard.changeCount == written { pasteboard.restore(saved) }
            return nil
        }
        guard let saved else { return InsertOutcome(method: .pasteCommandV, delivered: true, clipboardRestored: nil) }
        await sleep(restoreDelay)
        // The user copied something during the wait: keep their copy.
        guard pasteboard.changeCount == written else {
            return InsertOutcome(method: .pasteCommandV, delivered: true, clipboardRestored: false)
        }
        pasteboard.restore(saved)
        return InsertOutcome(method: .pasteCommandV, delivered: true, clipboardRestored: true)
    }

    public func pressReturn() -> Bool { keys.postReturn() }

    /// Types the text in chunks, each retried once. Returns false if a chunk failed twice.
    public func type(_ text: String) async -> Bool {
        for (index, chunk) in Self.chunks(text).enumerated() {
            if index > 0 { await sleep(Self.keystrokeGap) }
            if !keys.postText(chunk) {
                await sleep(Self.keystrokeGap)
                if !keys.postText(chunk) { return false }
            }
        }
        return true
    }

    /// Splits text into pieces of at most 20 UTF-16 units without breaking a character, so
    /// accents and emoji arrive whole. A single character longer than that is its own piece.
    public static func chunks(_ text: String) -> [String] {
        var result: [String] = []
        var current = ""
        var units = 0
        for character in text {
            let size = character.utf16.count
            if units + size > chunkLimit, !current.isEmpty {
                result.append(current)
                current = ""
                units = 0
            }
            current.append(character)
            units += size
        }
        if !current.isEmpty { result.append(current) }
        return result
    }
}

/// `insert.text` and `insert.copy`. Insertion waits for the restore delay, so it is answered
/// later through `reply`. One insertion at a time.
public final class InsertionController: @unchecked Sendable {
    // @unchecked: `busy` is read and written only while `lock` is held.
    private let lock = NSLock()
    private var busy = false

    private let inserter: Inserter
    private let pasteboard: any PasteboardAccess
    private let permissions: any PermissionProvider
    private let frontmostBundleId: @Sendable () -> String?
    private let reply: @Sendable (Envelope) -> Void

    /// Apps where paste does not reach the target (remote desktops): `auto` types instead.
    public static let keystrokeApps: Set<String> = [
        "com.microsoft.rdc.macos", "com.vmware.horizon", "com.citrix.receiver.icaviewer.mac",
    ]

    /// Pause between the text and Return, so the app has taken the paste first.
    static let enterDelayNanoseconds: UInt64 = 150_000_000

    static func strings(_ value: JSONValue?) -> Set<String> {
        Set((value?.arrayValue ?? []).compactMap(\.stringValue))
    }

    public init(
        inserter: Inserter,
        pasteboard: any PasteboardAccess,
        permissions: any PermissionProvider,
        frontmostBundleId: @escaping @Sendable () -> String?,
        reply: @escaping @Sendable (Envelope) -> Void
    ) {
        self.inserter = inserter
        self.pasteboard = pasteboard
        self.permissions = permissions
        self.frontmostBundleId = frontmostBundleId
        self.reply = reply
    }

    public func handle(id: String, type: String, payload: [String: JSONValue]) -> Envelope? {
        switch type {
        case "insert.text": return insertText(id: id, payload: payload)
        case "insert.copy": return copy(id: id, payload: payload)
        default: return MessageRouter.failure(id: id, requestType: type, .unsupportedRequest, "Unknown request type")
        }
    }

    private func copy(id: String, payload: [String: JSONValue]) -> Envelope {
        guard let text = payload["text"]?.stringValue else {
            return MessageRouter.failure(id: id, requestType: "insert.copy", .invalidPayload, "insert.copy needs text")
        }
        pasteboard.writeText(text)
        return MessageRouter.success(id: id, requestType: "insert.copy", [:])
    }

    private func insertText(id: String, payload: [String: JSONValue]) -> Envelope? {
        let type = "insert.text"
        guard let given = payload["text"]?.stringValue else {
            return MessageRouter.failure(id: id, requestType: type, .invalidPayload, "insert.text needs text")
        }
        let methodName = payload["method"]?.stringValue ?? "auto"
        guard let method = InsertMethod(rawValue: methodName) else {
            return MessageRouter.failure(
                id: id, requestType: type, .invalidPayload, "method must be auto, paste_cmd_v or keystrokes")
        }
        let restore = payload["restoreClipboard"]?.boolValue ?? true
        let delayMs = payload["restoreDelayMs"]?.intValue ?? 350
        guard (0...2_000).contains(delayMs) else {
            return MessageRouter.failure(id: id, requestType: type, .invalidPayload, "restoreDelayMs must be from 0 to 2000")
        }
        let pressEnter = payload["pressEnter"]?.boolValue ?? false
        let typeInApps = Self.strings(payload["typeInApps"])
        let trimInApps = Self.strings(payload["trimTrailingNewlinesInApps"])
        // The app that is in front now is the target; Return later goes only to the same app.
        let bundle = frontmostBundleId()
        var trimmed = given
        if let bundle, trimInApps.contains(bundle) {
            while trimmed.last?.isNewline == true { trimmed.removeLast() }
        }
        let text = trimmed
        let bundleValue: JSONValue = bundle.map { .string($0) } ?? .null
        if text.isEmpty && !pressEnter {
            return MessageRouter.success(
                id: id, requestType: type,
                [
                    "method": .string(method.rawValue), "delivered": .bool(false), "clipboardRestored": .null,
                    "appBundleId": bundleValue, "enterPressed": .null,
                ])
        }
        // Posting key events to other apps needs Accessibility. Read the status only.
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
            return MessageRouter.failure(id: id, requestType: type, .busy, "Another insertion is running")
        }
        let chosen: InsertMethod
        if method == .auto, let bundle, Self.keystrokeApps.contains(bundle) || typeInApps.contains(bundle) {
            chosen = .keystrokes
        } else {
            chosen = method == .auto ? .pasteCommandV : method
        }
        let inserter = self.inserter
        let frontmost = self.frontmostBundleId
        Task {
            var outcome: InsertOutcome?
            if text.isEmpty {
                // Only "press enter" was said: nothing to insert.
                outcome = InsertOutcome(method: .keystrokes, delivered: true, clipboardRestored: nil)
            } else if chosen == .pasteCommandV {
                outcome = await inserter.paste(text, restore: restore, restoreDelay: Double(delayMs) / 1000)
            }
            // Typed fallback when paste was not handled, or when typing was chosen.
            if outcome == nil {
                let typed = await inserter.type(text)
                outcome = InsertOutcome(method: .keystrokes, delivered: typed, clipboardRestored: nil)
            }
            // Return goes out only after the text, and only if the same app is still in front.
            var enterPressed: Bool?
            if pressEnter, outcome?.delivered == true {
                try? await Task.sleep(nanoseconds: Self.enterDelayNanoseconds)
                enterPressed = frontmost() == bundle && inserter.pressReturn()
            }
            lock.withLock { busy = false }
            guard let outcome, outcome.delivered else {
                reply(MessageRouter.failure(id: id, requestType: type, .pasteFailed, "Key events could not be posted"))
                return
            }
            reply(
                MessageRouter.success(
                    id: id, requestType: type,
                    [
                        "method": .string(outcome.method.rawValue), "delivered": .bool(true),
                        "clipboardRestored": outcome.clipboardRestored.map { .bool($0) } ?? .null,
                        "appBundleId": bundleValue,
                        "enterPressed": enterPressed.map { .bool($0) } ?? .null,
                    ]))
        }
        return nil
    }
}
