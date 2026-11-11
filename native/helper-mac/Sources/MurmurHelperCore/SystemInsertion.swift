import AppKit
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

    public func writeTransientText(_ text: String) -> Int {
        board.clearContents()
        let item = NSPasteboardItem()
        item.setString(text, forType: .string)
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

public enum Frontmost {
    /// Bundle id of the app in front. Needs no permission.
    public static func bundleId() -> String? {
        NSWorkspace.shared.frontmostApplication?.bundleIdentifier
    }
}
