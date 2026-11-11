import ApplicationServices
import Foundation

/// The focused field through Accessibility, for watching corrections (PZ-02). Secure fields
/// and fields whose value cannot be set are never watched; each call waits at most 0.25 s.
public struct SystemWatchedFieldSource: WatchedFieldSource {
    public init() {}

    public func focusedField() -> (any WatchedField)? {
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, 0.25)
        guard let element = Self.focused(system) else { return nil }
        AXUIElementSetMessagingTimeout(element, 0.25)
        let role = Self.string(element, kAXRoleAttribute)
        let subrole = Self.string(element, kAXSubroleAttribute)
        if FocusContext.isSecure(role: role, subrole: subrole) { return nil }
        var settable = DarwinBoolean(false)
        guard AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success,
            settable.boolValue
        else { return nil }
        return SystemWatchedField(element: element)
    }

    static func focused(_ system: AXUIElement) -> AXUIElement? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &value) == .success,
            let value, CFGetTypeID(value) == AXUIElementGetTypeID()
        else { return nil }
        return (value as! AXUIElement)
    }

    static func string(_ element: AXUIElement, _ name: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value as? String
    }
}

struct SystemWatchedField: WatchedField, @unchecked Sendable {
    // @unchecked: AXUIElement is an immutable reference used from one watch thread.
    let element: AXUIElement

    func value() -> String? { SystemWatchedFieldSource.string(element, kAXValueAttribute) }

    func isFocused() -> Bool {
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, 0.25)
        guard let now = SystemWatchedFieldSource.focused(system) else { return false }
        return CFEqual(now, element)
    }
}
