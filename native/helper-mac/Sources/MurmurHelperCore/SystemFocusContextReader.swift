import AppKit
import ApplicationServices
import Foundation

/// Reads the focused element through the Accessibility API. Needs Accessibility; the
/// controller checks it first. Each call waits at most a quarter of a second.
public struct SystemFocusContextReader: FocusContextReader {
    public init() {}

    public func read(maxBefore: Int, maxAfter: Int) -> FocusContext? {
        let app = Frontmost.application()
        var context = FocusContext(appName: app?.localizedName, bundleId: app?.bundleIdentifier)
        if let pid = app?.processIdentifier {
            if ChromiumAccessibility.shared.enableIfNeeded(pid: pid, bundleURL: app?.bundleURL) {
                Thread.sleep(forTimeInterval: ChromiumAccessibility.settleSeconds)
            }
            let appElement = AXUIElementCreateApplication(pid)
            AXUIElementSetMessagingTimeout(appElement, 0.25)
            if let window: AXUIElement = Self.attribute(appElement, kAXFocusedWindowAttribute) {
                context.windowTitle = Self.attribute(window, kAXTitleAttribute)
            }
        }
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, 0.25)
        guard let focused: AXUIElement = Self.attribute(system, kAXFocusedUIElementAttribute) else {
            return context
        }
        AXUIElementSetMessagingTimeout(focused, 0.25)
        context.role = Self.attribute(focused, kAXRoleAttribute)
        context.subrole = Self.attribute(focused, kAXSubroleAttribute)
        var settable = DarwinBoolean(false)
        if AXUIElementIsAttributeSettable(focused, kAXValueAttribute as CFString, &settable) == .success {
            context.editable = settable.boolValue
        }
        // Checked before anything else is read: a secure field's value is never asked for.
        if FocusContext.isSecure(role: context.role, subrole: context.subrole) {
            context.secure = true
            return context
        }
        let caret = Self.caret(focused)
        if let caret, let count: Int = Self.attribute(focused, kAXNumberOfCharactersAttribute) {
            // Ask only for the window around the caret, so a long document is not copied.
            let start = max(0, caret - maxBefore)
            let end = min(count, caret + maxAfter)
            if let piece = Self.string(focused, location: start, length: end - start) {
                let (before, after) = ContextWindow.slice(piece, caret: caret - start, before: maxBefore, after: maxAfter)
                context.textBefore = before
                context.textAfter = after
                return context
            }
        }
        if let value: String = Self.attribute(focused, kAXValueAttribute) {
            let (before, after) = ContextWindow.slice(value, caret: caret, before: maxBefore, after: maxAfter)
            context.textBefore = before
            context.textAfter = after
        }
        return context
    }

    static func attribute<T>(_ element: AXUIElement, _ name: String) -> T? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success, let value else {
            return nil
        }
        if T.self == AXUIElement.self, CFGetTypeID(value) == AXUIElementGetTypeID() {
            return (value as! AXUIElement) as? T
        }
        if T.self == Int.self, let number = value as? NSNumber { return number.intValue as? T }
        return value as? T
    }

    /// The caret: the start of the selected range, as a UTF-16 offset.
    static func caret(_ element: AXUIElement) -> Int? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &value) == .success,
            let value, CFGetTypeID(value) == AXValueGetTypeID()
        else { return nil }
        var range = CFRange()
        guard AXValueGetValue(value as! AXValue, .cfRange, &range) else { return nil }
        return range.location
    }

    static func string(_ element: AXUIElement, location: Int, length: Int) -> String? {
        var range = CFRange(location: location, length: length)
        guard length >= 0, let axRange = AXValueCreate(.cfRange, &range) else { return nil }
        var value: CFTypeRef?
        guard
            AXUIElementCopyParameterizedAttributeValue(
                element, kAXStringForRangeParameterizedAttribute as CFString, axRange, &value) == .success
        else { return nil }
        return value as? String
    }
}
