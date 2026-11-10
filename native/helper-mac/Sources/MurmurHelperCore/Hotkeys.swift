/// Hotkey bindings and the pure logic that turns raw key input into binding events.
/// Nothing here touches the OS, so every rule is covered by unit tests.

public enum HotkeyMode: String, Sendable, CaseIterable {
    /// Down and up events.
    case hold
    /// One press event per press. The helper does not track on or off.
    case toggle
    /// One press event per press.
    case press
}

public enum HotkeyModifier: String, Sendable, CaseIterable {
    case command
    case option
    case control
    case shift
    case fn
}

public enum HotkeyActions {
    /// Actions a binding may name. Main gives them meaning; the helper only passes them on.
    public static let all: Set<String> = [
        "dictate.hold", "dictate.toggle", "dictate.cancel", "paste.last", "copy.last",
        "scratchpad.open", "notetaker.start", "command.mode", "instruct.mode", "rewrite",
        "press.enter",
    ]
}

/// A key, with the exact set of modifiers that must be held. A modifier key on its own
/// (for example Right Option) has an empty modifier set.
public struct HotkeyTrigger: Sendable, Hashable {
    public var keyCode: Int
    public var modifiers: Set<HotkeyModifier>

    public init(keyCode: Int, modifiers: Set<HotkeyModifier> = []) {
        self.keyCode = keyCode
        self.modifiers = modifiers
    }

    public var isModifierOnly: Bool { KeyCodes.modifierFamily(of: keyCode) != nil }
}

public struct HotkeyBinding: Sendable, Equatable {
    public var id: String
    public var action: String
    public var trigger: HotkeyTrigger
    public var mode: HotkeyMode
    public var rewriteId: String?

    public init(id: String, action: String, trigger: HotkeyTrigger, mode: HotkeyMode, rewriteId: String? = nil) {
        self.id = id
        self.action = action
        self.trigger = trigger
        self.mode = mode
        self.rewriteId = rewriteId
    }
}

public enum HotkeyEventState: String, Sendable {
    case down
    case up
    case press
}

/// One event to send to main for one binding.
public struct HotkeyFiring: Sendable, Equatable {
    public var binding: HotkeyBinding
    public var state: HotkeyEventState
}

/// Key input reduced to what matching needs. Built from a CGEvent by the tap.
public enum RawKeyInput: Sendable, Equatable {
    /// A modifier key changed. `isDown` is for this specific key (left and right differ).
    case modifier(keyCode: Int, isDown: Bool)
    case keyDown(keyCode: Int, modifiers: Set<HotkeyModifier>, isRepeat: Bool)
    case keyUp(keyCode: Int)
}

/// macOS virtual key codes and modifier flags used by the matcher.
public enum KeyCodes {
    public static let rightOption = 61
    public static let leftOption = 58
    public static let capsLock = 57

    /// Function keys F1 to F20. They may be bound without modifiers.
    public static let functionKeys: Set<Int> = [
        122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90,
    ]

    /// Device-independent modifier flag bits (CGEventFlags).
    static let familyMask: [HotkeyModifier: UInt64] = [
        .shift: 0x0002_0000, .control: 0x0004_0000, .option: 0x0008_0000,
        .command: 0x0010_0000, .fn: 0x0080_0000,
    ]

    /// Modifier key code to its family and its device-specific flag bit (IOLLEvent.h).
    /// Fn has no left or right variant, so it has no device bit.
    static let modifierKeys: [Int: (family: HotkeyModifier, deviceBit: UInt64?)] = [
        59: (.control, 0x0000_0001), 62: (.control, 0x0000_2000),
        56: (.shift, 0x0000_0002), 60: (.shift, 0x0000_0004),
        55: (.command, 0x0000_0008), 54: (.command, 0x0000_0010),
        58: (.option, 0x0000_0020), 61: (.option, 0x0000_0040),
        63: (.fn, nil),
    ]

    public static func modifierFamily(of keyCode: Int) -> HotkeyModifier? {
        modifierKeys[keyCode]?.family
    }

    /// The modifiers held according to a flags value.
    public static func modifiers(from flags: UInt64) -> Set<HotkeyModifier> {
        Set(familyMask.compactMap { flags & $0.value != 0 ? $0.key : nil })
    }

    /// Whether this specific modifier key is down after a flags-changed event.
    /// Returns nil for key codes that are not modifier keys (Caps Lock included).
    public static func isModifierDown(keyCode: Int, flags: UInt64) -> Bool? {
        guard let entry = modifierKeys[keyCode], let family = familyMask[entry.family] else { return nil }
        guard flags & family != 0 else { return false }
        guard let deviceBit = entry.deviceBit else { return true }
        // Device bits for the whole family, so a keyboard that reports none falls back to
        // the family flag instead of reading every press as a release.
        let familyDeviceBits = modifierKeys.values
            .filter { $0.family == entry.family }
            .compactMap(\.deviceBit)
            .reduce(UInt64(0), |)
        if flags & familyDeviceBits == 0 { return true }
        return flags & deviceBit != 0
    }
}

public struct BindingRejection: Sendable, Equatable {
    public var id: String
    public var code: ErrorCode
    public var message: String
}

/// Matches raw key input against the bindings and keeps which bindings are held.
public struct HotkeyMatcher: Sendable {
    public private(set) var bindings: [HotkeyBinding] = []
    private var active: Set<String> = []

    public init() {}

    /// Replaces the bindings. Returns the up events for hold bindings that were down,
    /// so main never stays stuck in a held state.
    public mutating func replace(with bindings: [HotkeyBinding]) -> [HotkeyFiring] {
        let released = releaseAll()
        self.bindings = bindings
        return released
    }

    /// Forgets every held binding, returning up events for the hold ones. Used when input
    /// may have been missed, such as when the OS disabled the tap.
    public mutating func releaseAll() -> [HotkeyFiring] {
        let firings = bindings
            .filter { active.contains($0.id) && $0.mode == .hold }
            .map { HotkeyFiring(binding: $0, state: .up) }
        active.removeAll()
        return firings
    }

    /// Unmatched input returns an empty array and leaves no trace.
    public mutating func handle(_ input: RawKeyInput) -> [HotkeyFiring] {
        var firings: [HotkeyFiring] = []
        switch input {
        case .modifier(let keyCode, let isDown):
            for binding in bindings where binding.trigger.isModifierOnly && binding.trigger.keyCode == keyCode {
                if let firing = isDown ? press(binding) : release(binding) { firings.append(firing) }
            }
        case .keyDown(let keyCode, let modifiers, let isRepeat):
            if isRepeat { return [] }
            for binding in bindings
            where !binding.trigger.isModifierOnly && binding.trigger.keyCode == keyCode
                && Self.modifiersMatch(trigger: binding.trigger.modifiers, held: modifiers)
            {
                if let firing = press(binding) { firings.append(firing) }
            }
        case .keyUp(let keyCode):
            for binding in bindings where !binding.trigger.isModifierOnly && binding.trigger.keyCode == keyCode {
                if let firing = release(binding) { firings.append(firing) }
            }
        }
        return firings
    }

    /// Exact match, except that Fn only counts when the trigger names it: macOS sets the
    /// Fn flag by itself for arrow, navigation and function keys.
    static func modifiersMatch(trigger: Set<HotkeyModifier>, held: Set<HotkeyModifier>) -> Bool {
        if trigger.contains(.fn) { return trigger == held }
        return trigger == held.subtracting([.fn])
    }

    private mutating func press(_ binding: HotkeyBinding) -> HotkeyFiring? {
        guard !active.contains(binding.id) else { return nil }
        active.insert(binding.id)
        return HotkeyFiring(binding: binding, state: binding.mode == .hold ? .down : .press)
    }

    private mutating func release(_ binding: HotkeyBinding) -> HotkeyFiring? {
        guard active.contains(binding.id) else { return nil }
        active.remove(binding.id)
        return binding.mode == .hold ? HotkeyFiring(binding: binding, state: .up) : nil
    }

    // MARK: Parsing and validation

    public static let maxBindings = 64

    /// Reads the `bindings` array of a `hotkey.configure` payload. Each invalid binding is
    /// rejected on its own; the rest are kept. Returns nil when the payload itself is malformed.
    public static func parse(_ payload: [String: JSONValue]) -> (valid: [HotkeyBinding], rejected: [BindingRejection])? {
        guard case .array(let items)? = payload["bindings"], items.count <= maxBindings else { return nil }
        var valid: [HotkeyBinding] = []
        var rejected: [BindingRejection] = []
        var seenIds: Set<String> = []
        for (index, item) in items.enumerated() {
            let id = item.objectValue?["id"]?.stringValue ?? "#\(index)"
            switch parseBinding(item) {
            case .failure(let message):
                rejected.append(BindingRejection(id: id, code: .invalidPayload, message: message.text))
            case .success(let binding):
                if seenIds.contains(binding.id) {
                    rejected.append(BindingRejection(id: id, code: .invalidPayload, message: "Duplicate binding id"))
                } else if valid.contains(where: { $0.trigger == binding.trigger }) {
                    rejected.append(BindingRejection(id: id, code: .conflict, message: "Another binding already uses this trigger"))
                } else {
                    valid.append(binding)
                }
                seenIds.insert(binding.id)
            }
        }
        return (valid, rejected)
    }

    struct Problem: Error { var text: String }

    static func parseBinding(_ value: JSONValue) -> Result<HotkeyBinding, Problem> {
        func fail(_ text: String) -> Result<HotkeyBinding, Problem> { .failure(Problem(text: text)) }
        guard let object = value.objectValue else { return fail("Binding must be an object") }
        guard let id = object["id"]?.stringValue, !id.isEmpty, id.count <= 64 else {
            return fail("Binding id must be a string of 1 to 64 characters")
        }
        guard let action = object["action"]?.stringValue, HotkeyActions.all.contains(action) else {
            return fail("Unknown action")
        }
        var rewriteId: String?
        if action == "rewrite" {
            guard let value = object["rewriteId"]?.stringValue, !value.isEmpty else {
                return fail("The rewrite action needs a rewriteId")
            }
            rewriteId = value
        }
        guard let modeName = object["mode"]?.stringValue, let mode = HotkeyMode(rawValue: modeName) else {
            return fail("Mode must be hold, toggle or press")
        }
        guard let trigger = object["trigger"]?.objectValue else { return fail("Trigger must be an object") }
        guard trigger["type"]?.stringValue == "key" else {
            return fail("Only key triggers are supported in this version")
        }
        guard let keyCode = trigger["keyCode"]?.intValue, (0...127).contains(keyCode), keyCode != KeyCodes.capsLock else {
            return fail("keyCode must be a macOS virtual key code from 0 to 127, not Caps Lock")
        }
        guard case .array(let names)? = trigger["modifiers"] else { return fail("modifiers must be an array") }
        var modifiers: Set<HotkeyModifier> = []
        for name in names {
            guard let text = name.stringValue, let modifier = HotkeyModifier(rawValue: text), !modifiers.contains(modifier) else {
                return fail("modifiers must be distinct values from command, option, control, shift, fn")
            }
            modifiers.insert(modifier)
        }
        let parsed = HotkeyTrigger(keyCode: keyCode, modifiers: modifiers)
        if parsed.isModifierOnly && !modifiers.isEmpty {
            return fail("A modifier key on its own cannot have modifiers")
        }
        if !parsed.isModifierOnly && modifiers.isEmpty && !KeyCodes.functionKeys.contains(keyCode) {
            return fail("This key needs at least one modifier")
        }
        return .success(HotkeyBinding(id: id, action: action, trigger: parsed, mode: mode, rewriteId: rewriteId))
    }
}
