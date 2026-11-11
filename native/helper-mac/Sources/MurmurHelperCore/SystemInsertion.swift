import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

/// The general pasteboard. Text Murmur puts there only for pasting is marked with the
/// nspasteboard.org transient and concealed types, which clipboard managers skip.
public final class SystemPasteboard: PasteboardAccess, @unchecked Sendable {
    // @unchecked: NSPasteboard is used from one insertion at a time.
    private let board: NSPasteboard
    private static let transient = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")
    private static let concealed = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")

    /// The general pasteboard by default. Tests pass a private, named one.
    public init(board: NSPasteboard = .general) { self.board = board }

    public var changeCount: Int { board.changeCount }

    public func snapshot() -> PasteboardSnapshot {
        let items = (board.pasteboardItems ?? []).map { item -> [String: Data] in
            var types: [String: Data] = [:]
            for type in item.types {
                if let data = item.data(forType: type) { types[type.rawValue] = data }
            }
            return types
        }
        return PasteboardSnapshot(items: items)
    }

    public func writeTransientText(_ text: String, html: String?) -> Int {
        board.clearContents()
        let item = NSPasteboardItem()
        item.setString(text, forType: .string)
        if let html { item.setString(html, forType: .html) }
        item.setData(Data(), forType: Self.transient)
        item.setData(Data(), forType: Self.concealed)
        board.writeObjects([item])
        return board.changeCount
    }

    public func writeText(_ text: String) {
        board.clearContents()
        board.setString(text, forType: .string)
    }

    public func restore(_ snapshot: PasteboardSnapshot) {
        board.clearContents()
        guard !snapshot.items.isEmpty else { return }
        let items = snapshot.items.map { types -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in types { item.setData(data, forType: NSPasteboard.PasteboardType(type)) }
            return item
        }
        board.writeObjects(items)
    }
}

/// Posts synthetic key events to the focused app through the HID event stream.
/// Needs Accessibility; the controller checks it before calling.
public struct SystemKeyPoster: KeyPoster {
    private static let keyV: CGKeyCode = 9
    private static let keyReturn: CGKeyCode = 36

    public init() {}

    public func postPaste() -> Bool {
        let source = CGEventSource(stateID: .combinedSessionState)
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: Self.keyV, keyDown: true),
            let up = CGEvent(keyboardEventSource: source, virtualKey: Self.keyV, keyDown: false)
        else { return false }
        // Command only, whatever modifiers are physically held.
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        return true
    }

    public func postReturn() -> Bool {
        let source = CGEventSource(stateID: .combinedSessionState)
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: Self.keyReturn, keyDown: true),
            let up = CGEvent(keyboardEventSource: source, virtualKey: Self.keyReturn, keyDown: false)
        else { return false }
        down.flags = []
        up.flags = []
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        return true
    }

    public func postText(_ chunk: String) -> Bool {
        let units = Array(chunk.utf16)
        let source = CGEventSource(stateID: .combinedSessionState)
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
            let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        else { return false }
        down.flags = []
        up.flags = []
        units.withUnsafeBufferPointer { buffer in
            down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
            up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: buffer.baseAddress)
        }
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
        return true
    }
}

/// The app in front. `NSWorkspace.frontmostApplication` is refreshed only through the main
/// run loop, which the helper never runs (its main thread reads stdin), so it would keep the
/// app that was in front at launch. These lookups ask the system each time instead.
public enum Frontmost {
    public static func bundleId() -> String? {
        application()?.bundleIdentifier
    }

    public static func application() -> NSRunningApplication? {
        guard let pid = firstPid([accessibilityPid, windowOwnerPid, { NSWorkspace.shared.frontmostApplication?.processIdentifier }])
        else { return nil }
        return NSRunningApplication(processIdentifier: pid)
    }

    /// The first lookup that finds an app wins.
    static func firstPid(_ lookups: [() -> pid_t?]) -> pid_t? {
        for lookup in lookups {
            if let pid = lookup(), pid > 0 { return pid }
        }
        return nil
    }

    /// The focused application, through Accessibility (nil without the permission).
    static func accessibilityPid() -> pid_t? {
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, 0.25)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(system, kAXFocusedApplicationAttribute as CFString, &value) == .success,
            let value, CFGetTypeID(value) == AXUIElementGetTypeID()
        else { return nil }
        var pid: pid_t = 0
        guard AXUIElementGetPid(value as! AXUIElement, &pid) == .success else { return nil }
        return pid
    }

    /// The owner of the top normal window on screen. Reads owner ids only, no titles, so it
    /// needs no permission.
    static func windowOwnerPid() -> pid_t? {
        guard
            let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                as? [[String: Any]]
        else { return nil }
        for window in windows where (window[kCGWindowLayer as String] as? Int) == 0 {
            if let pid = window[kCGWindowOwnerPID as String] as? Int { return pid_t(pid) }
        }
        return nil
    }
}
