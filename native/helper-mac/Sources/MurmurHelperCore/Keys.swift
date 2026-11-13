import Foundation

/// `keys.press` (RW-09, RW-13): one key from a fixed list, for bold, italic, select all,
/// undo, Return, Delete, caret moves and browser back. Anything else is refused, so main cannot type
/// arbitrary input into another app.
public struct KeysController: Sendable {
    /// Key names to macOS virtual key codes.
    static let keyCodes: [String: UInt16] = [
        "b": 11, "i": 34, "a": 0, "z": 6, "return": 36,
        "left": 123, "right": 124, "down": 125, "up": 126, "left_bracket": 33, "delete": 51,
    ]
    static let modifierNames: [String: KeyModifiers] = [
        "command": .command, "shift": .shift, "option": .option, "control": .control,
    ]

    let keys: any KeyPoster
    let permissions: any PermissionProvider
    let frontmostBundleId: @Sendable () -> String?

    public init(
        keys: any KeyPoster, permissions: any PermissionProvider,
        frontmostBundleId: @escaping @Sendable () -> String?
    ) {
        self.keys = keys
        self.permissions = permissions
        self.frontmostBundleId = frontmostBundleId
    }

    /// The same rule as `keyComboAllowed` in packages/shared.
    static func allowed(_ key: String, _ modifiers: KeyModifiers) -> Bool {
        switch key {
        case "b", "i", "a", "left_bracket": return modifiers == .command
        case "z": return modifiers.contains(.command) && !modifiers.contains(.option) && !modifiers.contains(.control)
        case "return": return modifiers.isEmpty || modifiers == .shift
        case "delete": return modifiers.isEmpty
        case "left", "right", "up", "down": return !modifiers.contains(.control)
        default: return false
        }
    }

    public func press(id: String, payload: [String: JSONValue]) -> Envelope {
        let type = "keys.press"
        guard let key = payload["key"]?.stringValue, let code = Self.keyCodes[key] else {
            return MessageRouter.failure(id: id, requestType: type, .invalidPayload, "key is not on the allowed list")
        }
        let names = (payload["modifiers"]?.arrayValue ?? []).compactMap(\.stringValue)
        var modifiers: KeyModifiers = []
        for name in names {
            guard let flag = Self.modifierNames[name], !modifiers.contains(flag) else {
                return MessageRouter.failure(id: id, requestType: type, .invalidPayload, "Unknown or repeated modifier")
            }
            modifiers.insert(flag)
        }
        guard Self.allowed(key, modifiers) else {
            return MessageRouter.failure(id: id, requestType: type, .invalidPayload, "This key combination is not allowed")
        }
        let repeatCount = payload["repeat"]?.intValue ?? 1
        guard (1...200).contains(repeatCount) else {
            return MessageRouter.failure(id: id, requestType: type, .invalidPayload, "repeat must be from 1 to 200")
        }
        // Posting key events to other apps needs Accessibility. Read the status only.
        guard permissions.status(of: .accessibility) == .granted else {
            return MessageRouter.failure(
                id: id, requestType: type, .permissionDenied, "accessibility: Accessibility is not granted")
        }
        let bundle = frontmostBundleId()
        let bundleValue: JSONValue = bundle.map { .string($0) } ?? .null
        if let only = payload["onlyInApp"]?.stringValue, only != bundle {
            return MessageRouter.success(id: id, requestType: type, ["pressed": .bool(false), "appBundleId": bundleValue])
        }
        for _ in 0..<repeatCount where !keys.postKey(code, modifiers: modifiers) {
            return MessageRouter.failure(id: id, requestType: type, .pasteFailed, "Key events could not be posted")
        }
        return MessageRouter.success(id: id, requestType: type, ["pressed": .bool(true), "appBundleId": bundleValue])
    }
}
