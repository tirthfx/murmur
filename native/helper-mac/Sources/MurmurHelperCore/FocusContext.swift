import Foundation

/// What the focused field shows around the caret (DC-30). Secure fields carry no text.
public struct FocusContext: Sendable, Equatable {
    public var appName: String?
    public var bundleId: String?
    public var windowTitle: String?
    public var role: String?
    public var subrole: String?
    public var editable: Bool
    public var secure: Bool
    public var textBefore: String
    public var textAfter: String

    public init(
        appName: String? = nil, bundleId: String? = nil, windowTitle: String? = nil, role: String? = nil,
        subrole: String? = nil, editable: Bool = false, secure: Bool = false, textBefore: String = "",
        textAfter: String = ""
    ) {
        self.appName = appName
        self.bundleId = bundleId
        self.windowTitle = windowTitle
        self.role = role
        self.subrole = subrole
        self.editable = editable
        self.secure = secure
        self.textBefore = textBefore
        self.textAfter = textAfter
    }

    /// Password fields and anything marked secure.
    public static func isSecure(role: String?, subrole: String?) -> Bool {
        role == "AXSecureTextField" || subrole == "AXSecureTextField"
    }
}

/// Reads the focused element. The system one uses the Accessibility API; tests use a fake.
public protocol FocusContextReader: Sendable {
    /// Must not read any text from a secure field.
    func read(maxBefore: Int, maxAfter: Int) -> FocusContext?
}

public enum ContextWindow {
    /// The text before and after the caret, at most `before` and `after` UTF-16 units, cut at
    /// whole characters. `caret` is a UTF-16 offset (the way Accessibility reports ranges);
    /// nil means the end of the text.
    public static func slice(_ text: String, caret: Int?, before: Int, after: Int) -> (String, String) {
        let count = text.utf16.count
        let position = min(max(caret ?? count, 0), count)
        let start = boundary(text, max(0, position - before), roundUp: true)
        let middle = boundary(text, position, roundUp: false)
        let end = boundary(text, min(count, position + after), roundUp: false)
        let head = start <= middle ? String(text[start..<middle]) : ""
        let tail = middle <= end ? String(text[middle..<end]) : ""
        return (head, tail)
    }

    /// The character boundary at or next to a UTF-16 offset.
    private static func boundary(_ text: String, _ offset: Int, roundUp: Bool) -> String.Index {
        let index = text.utf16.index(text.utf16.startIndex, offsetBy: offset)
        if index == text.endIndex || index.samePosition(in: text) != nil { return index }
        let character = text.rangeOfComposedCharacterSequence(at: index)
        return roundUp ? character.upperBound : character.lowerBound
    }
}

/// `context.snapshot`. Answered later through `reply`, because Accessibility calls can take a
/// moment and must not hold up the request loop.
public final class ContextController: @unchecked Sendable {
    // @unchecked: the stored properties are immutable.
    private let reader: any FocusContextReader
    private let permissions: any PermissionProvider
    private let reply: @Sendable (Envelope) -> Void

    public static let maxBefore = 1_500
    public static let maxAfter = 300

    public init(
        reader: any FocusContextReader, permissions: any PermissionProvider,
        reply: @escaping @Sendable (Envelope) -> Void
    ) {
        self.reader = reader
        self.permissions = permissions
        self.reply = reply
    }

    public func snapshot(id: String, payload: [String: JSONValue]) -> Envelope? {
        let type = "context.snapshot"
        let before = payload["maxBefore"]?.intValue ?? Self.maxBefore
        let after = payload["maxAfter"]?.intValue ?? Self.maxAfter
        guard (0...Self.maxBefore).contains(before), (0...Self.maxAfter).contains(after) else {
            return MessageRouter.failure(
                id: id, requestType: type, .invalidPayload,
                "maxBefore must be 0 to \(Self.maxBefore) and maxAfter 0 to \(Self.maxAfter)")
        }
        // Reading another app's fields needs Accessibility. Read the status only.
        guard permissions.status(of: .accessibility) == .granted else {
            return MessageRouter.failure(
                id: id, requestType: type, .permissionDenied, "accessibility: Accessibility is not granted")
        }
        let reader = self.reader
        let reply = self.reply
        DispatchQueue.global(qos: .userInitiated).async {
            guard var context = reader.read(maxBefore: before, maxAfter: after) else {
                reply(MessageRouter.failure(id: id, requestType: type, .contextUnavailable, "No focused element"))
                return
            }
            // Defence in depth: whatever the reader did, a secure field gives no text.
            if context.secure || FocusContext.isSecure(role: context.role, subrole: context.subrole) {
                context.secure = true
                context.textBefore = ""
                context.textAfter = ""
            }
            let optional: (String?) -> JSONValue = { $0.map { .string($0) } ?? .null }
            reply(
                MessageRouter.success(
                    id: id, requestType: type,
                    [
                        "appName": optional(context.appName), "bundleId": optional(context.bundleId),
                        "windowTitle": optional(context.windowTitle), "role": optional(context.role),
                        "subrole": optional(context.subrole), "editable": .bool(context.editable),
                        "secure": .bool(context.secure), "textBefore": .string(context.textBefore),
                        "textAfter": .string(context.textAfter),
                    ]))
        }
        return nil
    }
}
