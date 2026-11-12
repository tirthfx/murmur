import AppKit
import ApplicationServices
import Foundation

/// Reads the selection in the focused element through Accessibility. Needs Accessibility;
/// the controller checks it first. Each call waits at most a quarter of a second.
public struct SystemSelectionReader: SelectionReader {
    public init() {}

    public func read(maxLength: Int) -> AXSelection {
        if let app = Frontmost.application(),
            ChromiumAccessibility.shared.enableIfNeeded(pid: app.processIdentifier, bundleURL: app.bundleURL)
        {
            Thread.sleep(forTimeInterval: ChromiumAccessibility.settleSeconds)
        }
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, 0.25)
        guard let focused: AXUIElement = SystemFocusContextReader.attribute(system, kAXFocusedUIElementAttribute)
        else { return .noFocus }
        AXUIElementSetMessagingTimeout(focused, 0.25)
        let role: String? = SystemFocusContextReader.attribute(focused, kAXRoleAttribute)
        let subrole: String? = SystemFocusContextReader.attribute(focused, kAXSubroleAttribute)
        // Checked before anything else is read: a secure field's text is never asked for.
        if FocusContext.isSecure(role: role, subrole: subrole) { return .secure }
        let range = Self.selectedRange(focused)
        // Over the limit: report the size without copying the text out of the app.
        if let range, range.length > maxLength {
            return .selected(text: nil, location: range.location, length: range.length)
        }
        if let text: String = SystemFocusContextReader.attribute(focused, kAXSelectedTextAttribute) {
            let length = text.utf16.count
            if length > maxLength { return .selected(text: nil, location: range?.location, length: length) }
            return .selected(text: text, location: range?.location, length: length)
        }
        if let range {
            let text = range.length == 0
                ? "" : SystemFocusContextReader.string(focused, location: range.location, length: range.length)
            return .selected(text: text, location: range.location, length: range.length)
        }
        return .unsupported
    }

    private static func selectedRange(_ element: AXUIElement) -> (location: Int, length: Int)? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &value) == .success,
            let value, CFGetTypeID(value) == AXValueGetTypeID()
        else { return nil }
        var range = CFRange()
        guard AXValueGetValue(value as! AXValue, .cfRange, &range) else { return nil }
        return (range.location, range.length)
    }
}
