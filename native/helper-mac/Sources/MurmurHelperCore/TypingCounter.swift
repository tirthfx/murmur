/// Counts typed words from key presses alone (DC-08). Only key codes are looked at, and
/// only to tell a separator (space, return, tab) from a key that types something; no
/// character is read, kept or sent. The count lives in memory and resets on each report.
public struct TypingCounter: Sendable {
    public private(set) var words = 0
    private var inWord = false

    /// Space, return, keypad enter, tab.
    static let separators: Set<Int> = [49, 36, 76, 48]
    /// Keys that type nothing: editing, arrows, navigation, escape, and the function keys.
    static let nonTyping: Set<Int> = Set([51, 117, 123, 124, 125, 126, 115, 119, 116, 121, 53, 114])
        .union(KeyCodes.functionKeys)

    public init() {}

    public mutating func handle(_ input: RawKeyInput) {
        guard case .keyDown(let keyCode, let modifiers, let isRepeat) = input, !isRepeat else { return }
        // Shortcuts are not typing.
        if modifiers.contains(.command) || modifiers.contains(.control) { return }
        if Self.separators.contains(keyCode) {
            if inWord { words += 1 }
            inWord = false
        } else if !Self.nonTyping.contains(keyCode) {
            inWord = true
        }
    }

    /// The words counted since the last call, and a fresh start.
    public mutating func take() -> Int {
        let count = words
        words = 0
        return count
    }
}
