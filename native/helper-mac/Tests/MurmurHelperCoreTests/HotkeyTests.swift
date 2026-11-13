import Foundation
import XCTest

@testable import MurmurHelperCore

private let rightOptionHold = HotkeyBinding(
    id: "dictate-hold", action: "dictate.hold", trigger: HotkeyTrigger(keyCode: KeyCodes.rightOption), mode: .hold)

/// Option+Shift+Space, the kind of chord a user could bind later.
private func chord(_ mode: HotkeyMode, id: String = "chord") -> HotkeyBinding {
    HotkeyBinding(
        id: id, action: "dictate.toggle", trigger: HotkeyTrigger(keyCode: 49, modifiers: [.option, .shift]), mode: mode)
}

final class HotkeyMatcherTests: XCTestCase {
    private func matcher(_ bindings: [HotkeyBinding]) -> HotkeyMatcher {
        var matcher = HotkeyMatcher()
        _ = matcher.replace(with: bindings)
        return matcher
    }

    func testRightOptionGivesDownThenUp() {
        var m = matcher([rightOptionHold])
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: true)), [HotkeyFiring(binding: rightOptionHold, state: .down)])
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: false)), [HotkeyFiring(binding: rightOptionHold, state: .up)])
    }

    func testAMouseButtonHoldsLikeAKey() {
        let mouseHold = HotkeyBinding(
            id: "mouse-hold", action: "dictate.hold", trigger: HotkeyTrigger(mouseButton: 3), mode: .hold)
        var m = matcher([rightOptionHold, mouseHold])
        XCTAssertEqual(m.handle(.mouseDown(button: 4)), [])
        XCTAssertEqual(m.handle(.mouseDown(button: 3)), [HotkeyFiring(binding: mouseHold, state: .down)])
        XCTAssertEqual(m.handle(.mouseUp(button: 3)), [HotkeyFiring(binding: mouseHold, state: .up)])
        // A key with the same number is not the mouse button.
        XCTAssertEqual(m.handle(.keyDown(keyCode: 3, modifiers: [], isRepeat: false)), [])
    }

    func testLeftAndRightClicksNeverBecomeInput() {
        XCTAssertNil(TapHandler.mouseInput(type: .otherMouseDown, button: 0))
        XCTAssertNil(TapHandler.mouseInput(type: .otherMouseDown, button: 1))
        XCTAssertEqual(TapHandler.mouseInput(type: .otherMouseDown, button: 2), .mouseDown(button: 2))
        XCTAssertEqual(TapHandler.mouseInput(type: .otherMouseUp, button: 4), .mouseUp(button: 4))
    }

    func testAnExclusiveHoldEndsWhenAnotherKeyIsPressed() {
        let commandKey = HotkeyBinding(
            id: "command-mode", action: "command.mode", trigger: HotkeyTrigger(keyCode: 54), mode: .hold, exclusive: true)
        var m = matcher([commandKey, rightOptionHold])
        // Right Command then C (Command+C): interrupted, and its release sends nothing.
        XCTAssertEqual(m.handle(.modifier(keyCode: 54, isDown: true)).map(\.state), [.down])
        XCTAssertEqual(
            m.handle(.keyDown(keyCode: 8, modifiers: [.command], isRepeat: false)),
            [HotkeyFiring(binding: commandKey, state: .interrupted)])
        XCTAssertEqual(m.handle(.keyUp(keyCode: 8)), [])
        XCTAssertEqual(m.handle(.modifier(keyCode: 54, isDown: false)), [])
        // Held alone, it goes down and up as usual.
        XCTAssertEqual(m.handle(.modifier(keyCode: 54, isDown: true)).map(\.state), [.down])
        XCTAssertEqual(m.handle(.modifier(keyCode: 54, isDown: false)).map(\.state), [.up])
        // Another modifier or a mouse button interrupts it too; the other binding still fires.
        XCTAssertEqual(m.handle(.modifier(keyCode: 54, isDown: true)).map(\.state), [.down])
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: true)).map(\.state), [.interrupted, .down])
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: false)).map(\.state), [.up])
        XCTAssertEqual(m.handle(.modifier(keyCode: 54, isDown: true)).map(\.state), [.down])
        XCTAssertEqual(m.handle(.mouseDown(button: 3)).map(\.state), [.interrupted])
    }

    func testANormalHoldIgnoresOtherKeys() {
        var m = matcher([rightOptionHold])
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: true)).map(\.state), [.down])
        XCTAssertEqual(m.handle(.keyDown(keyCode: 0, modifiers: [.option], isRepeat: false)), [])
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: false)).map(\.state), [.up])
    }

    func testLeftOptionDoesNothing() {
        var m = matcher([rightOptionHold])
        XCTAssertEqual(m.handle(.modifier(keyCode: 58, isDown: true)), [])
        XCTAssertEqual(m.handle(.modifier(keyCode: 58, isDown: false)), [])
    }

    func testRightOptionWhileLeftOptionHeld() {
        var m = matcher([rightOptionHold])
        XCTAssertEqual(m.handle(.modifier(keyCode: 58, isDown: true)), [])
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: true)).map(\.state), [.down])
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: false)).map(\.state), [.up])
    }

    func testSecondDownWithoutUpAndStrayUpAreIgnored() {
        var m = matcher([rightOptionHold])
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: false)), [])
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: true)).count, 1)
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: true)), [])
    }

    func testTypingWhileHoldingDoesNotFire() {
        var m = matcher([rightOptionHold])
        _ = m.handle(.modifier(keyCode: 61, isDown: true))
        XCTAssertEqual(m.handle(.keyDown(keyCode: 0, modifiers: [.option], isRepeat: false)), [])
        XCTAssertEqual(m.handle(.keyUp(keyCode: 0)), [])
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: false)).map(\.state), [.up])
    }

    func testChordHoldNeedsExactModifiersAndIgnoresRepeat() {
        let binding = chord(.hold)
        var m = matcher([binding])
        XCTAssertEqual(m.handle(.keyDown(keyCode: 49, modifiers: [.option], isRepeat: false)), [])
        XCTAssertEqual(m.handle(.keyDown(keyCode: 49, modifiers: [.option, .shift, .command], isRepeat: false)), [])
        XCTAssertEqual(m.handle(.keyDown(keyCode: 49, modifiers: [.option, .shift], isRepeat: false)).map(\.state), [.down])
        XCTAssertEqual(m.handle(.keyDown(keyCode: 49, modifiers: [.option, .shift], isRepeat: true)), [])
        XCTAssertEqual(m.handle(.keyUp(keyCode: 49)).map(\.state), [.up])
    }

    func testChordIgnoresFnUnlessNamed() {
        var m = matcher([chord(.press)])
        XCTAssertEqual(m.handle(.keyDown(keyCode: 49, modifiers: [.option, .shift, .fn], isRepeat: false)).map(\.state), [.press])
        let fnSpace = HotkeyBinding(
            id: "fn-space", action: "dictate.toggle", trigger: HotkeyTrigger(keyCode: 49, modifiers: [.fn]), mode: .press)
        var n = matcher([fnSpace])
        XCTAssertEqual(n.handle(.keyDown(keyCode: 49, modifiers: [], isRepeat: false)), [])
        XCTAssertEqual(n.handle(.keyDown(keyCode: 49, modifiers: [.fn], isRepeat: false)).map(\.state), [.press])
    }

    func testPressAndToggleModesSendOnePressAndNoUp() {
        for mode in [HotkeyMode.press, .toggle] {
            var m = matcher([chord(mode)])
            XCTAssertEqual(m.handle(.keyDown(keyCode: 49, modifiers: [.option, .shift], isRepeat: false)).map(\.state), [.press])
            XCTAssertEqual(m.handle(.keyDown(keyCode: 49, modifiers: [.option, .shift], isRepeat: false)), [])
            XCTAssertEqual(m.handle(.keyUp(keyCode: 49)), [])
            XCTAssertEqual(m.handle(.keyDown(keyCode: 49, modifiers: [.option, .shift], isRepeat: false)).map(\.state), [.press])
        }
    }

    func testReleaseAllSendsUpOnlyForHeldHoldBindings() {
        var m = matcher([rightOptionHold, chord(.press)])
        _ = m.handle(.modifier(keyCode: 61, isDown: true))
        _ = m.handle(.keyDown(keyCode: 49, modifiers: [.option, .shift], isRepeat: false))
        XCTAssertEqual(m.releaseAll(), [HotkeyFiring(binding: rightOptionHold, state: .up)])
        XCTAssertEqual(m.releaseAll(), [])
        XCTAssertEqual(m.handle(.modifier(keyCode: 61, isDown: false)), [])
    }

    func testReplaceReleasesHeldBindings() {
        var m = matcher([rightOptionHold])
        _ = m.handle(.modifier(keyCode: 61, isDown: true))
        XCTAssertEqual(m.replace(with: []).map(\.state), [.up])
    }

    func testModifierDownFromFlags() {
        let option: UInt64 = 0x0008_0000
        let rightBit: UInt64 = 0x40
        let leftBit: UInt64 = 0x20
        XCTAssertEqual(KeyCodes.isModifierDown(keyCode: 61, flags: option | rightBit), true)
        XCTAssertEqual(KeyCodes.isModifierDown(keyCode: 61, flags: option | leftBit), false)
        XCTAssertEqual(KeyCodes.isModifierDown(keyCode: 61, flags: 0), false)
        // A keyboard that reports no device bits falls back to the family flag.
        XCTAssertEqual(KeyCodes.isModifierDown(keyCode: 61, flags: option), true)
        XCTAssertEqual(KeyCodes.isModifierDown(keyCode: 63, flags: 0x0080_0000), true)
        XCTAssertNil(KeyCodes.isModifierDown(keyCode: KeyCodes.capsLock, flags: 0x0001_0000))
        XCTAssertNil(KeyCodes.isModifierDown(keyCode: 0, flags: option))
    }

    func testInputFromCGEventFields() {
        XCTAssertEqual(
            TapHandler.input(type: .flagsChanged, keyCode: 61, flags: 0x0008_0040, isRepeat: false),
            .modifier(keyCode: 61, isDown: true))
        XCTAssertEqual(
            TapHandler.input(type: .keyDown, keyCode: 49, flags: 0x000A_0000, isRepeat: true),
            .keyDown(keyCode: 49, modifiers: [.option, .shift], isRepeat: true))
        XCTAssertEqual(TapHandler.input(type: .keyUp, keyCode: 49, flags: 0, isRepeat: false), .keyUp(keyCode: 49))
        XCTAssertNil(TapHandler.input(type: .flagsChanged, keyCode: KeyCodes.capsLock, flags: 0x0001_0000, isRepeat: false))
    }
}

final class HotkeyParseTests: XCTestCase {
    private func binding(
        id: String = "b", action: String = "dictate.hold", keyCode: Int = 61, modifiers: [String] = [],
        mode: String = "hold", type: String = "key"
    ) -> JSONValue {
        .object([
            "id": .string(id), "action": .string(action), "mode": .string(mode),
            "trigger": .object([
                "type": .string(type), "keyCode": .int(keyCode), "modifiers": .array(modifiers.map { .string($0) }),
            ]),
        ])
    }

    private func reasons(_ items: [JSONValue]) -> [String: String] {
        let parsed = HotkeyMatcher.parse(["bindings": .array(items)])!
        return Dictionary(uniqueKeysWithValues: parsed.rejected.map { ($0.id, "\($0.code.rawValue): \($0.message)") })
    }

    func testExclusiveIsReadForHoldBindingsOnly() {
        func with(_ value: JSONValue, mode: String = "hold", id: String = "x") -> JSONValue {
            guard case .object(var object) = binding(id: id, keyCode: 54, mode: mode) else { return .null }
            object["exclusive"] = value
            return .object(object)
        }
        let parsed = HotkeyMatcher.parse(["bindings": .array([with(.bool(true))])])!
        XCTAssertEqual(parsed.valid.map(\.exclusive), [true])
        XCTAssertEqual(
            reasons([with(.bool(true), mode: "press", id: "p"), with(.string("yes"), id: "s")]),
            [
                "p": "INVALID_PAYLOAD: Only a hold binding can be exclusive",
                "s": "INVALID_PAYLOAD: exclusive must be true or false",
            ])
        XCTAssertEqual(HotkeyMatcher.parse(["bindings": .array([binding()])])!.valid.map(\.exclusive), [false])
    }

    func testMalformedPayloadIsNil() {
        XCTAssertNil(HotkeyMatcher.parse([:]))
        XCTAssertNil(HotkeyMatcher.parse(["bindings": .object([:])]))
        XCTAssertNil(HotkeyMatcher.parse(["bindings": .array(Array(repeating: binding(), count: 65))]))
    }

    func testValidBindingsAreKeptInOrder() {
        let parsed = HotkeyMatcher.parse([
            "bindings": .array([binding(id: "a"), binding(id: "b", keyCode: 49, modifiers: ["option", "shift"], mode: "press")]),
        ])!
        XCTAssertEqual(parsed.valid.map(\.id), ["a", "b"])
        XCTAssertEqual(parsed.valid[1].trigger.modifiers, [.option, .shift])
        XCTAssertEqual(parsed.rejected, [])
    }

    func testEachProblemIsRejectedOnItsOwn() {
        let rejected = reasons([
            binding(id: "ok"),
            binding(id: "ok", keyCode: 54),
            binding(id: "same-trigger"),
            binding(id: "action", action: "launch.rockets", keyCode: 54),
            binding(id: "mode", keyCode: 54, mode: "forever"),
            binding(id: "mouse", type: "mouseButton"),
            binding(id: "caps", keyCode: KeyCodes.capsLock),
            binding(id: "range", keyCode: 200),
            binding(id: "mods", keyCode: 54, modifiers: ["shift"]),
            binding(id: "plain", keyCode: 0),
            binding(id: "unknown-mod", keyCode: 0, modifiers: ["hyper"]),
            binding(id: "rewrite", action: "rewrite", keyCode: 0, modifiers: ["command"]),
        ])
        XCTAssertEqual(rejected.count, 11)
        XCTAssertEqual(rejected["same-trigger"], "CONFLICT: Another binding already uses this trigger")
        XCTAssertTrue(rejected["ok"]!.hasPrefix("INVALID_PAYLOAD: Duplicate"))
        for id in ["action", "mode", "mouse", "caps", "range", "mods", "plain", "unknown-mod", "rewrite"] {
            XCTAssertTrue(rejected[id]?.hasPrefix("INVALID_PAYLOAD") ?? false, id)
        }
    }

    func testMouseTriggersAllowOnlyExtraButtons() {
        func mouse(_ id: String, _ button: JSONValue) -> JSONValue {
            .object([
                "id": .string(id), "action": .string("dictate.hold"), "mode": .string("hold"),
                "trigger": .object(["type": .string("mouse"), "button": button]),
            ])
        }
        let parsed = HotkeyMatcher.parse([
            "bindings": .array([mouse("middle", .int(2)), mouse("back", .int(3)), mouse("left", .int(0)),
                mouse("right", .int(1)), mouse("text", .string("4")), mouse("dup", .int(3))]),
        ])!
        XCTAssertEqual(parsed.valid.map(\.id), ["middle", "back"])
        XCTAssertEqual(parsed.valid[1].trigger, HotkeyTrigger(mouseButton: 3))
        let rejected = Dictionary(uniqueKeysWithValues: parsed.rejected.map { ($0.id, $0.code) })
        XCTAssertEqual(rejected, ["left": .invalidPayload, "right": .invalidPayload, "text": .invalidPayload, "dup": .conflict])
    }

    func testFunctionKeyAloneIsAllowed() {
        XCTAssertEqual(reasons([binding(id: "f5", keyCode: 96, mode: "press")]), [:])
    }
}

/// Stands in for the event tap. Tests push input by hand.
final class FakeKeySource: KeyEventSource, @unchecked Sendable {
    private let lock = NSLock()
    private var onInput: (@Sendable (RawKeyInput, Int) -> Void)?
    private var onStatus: (@Sendable (TapStatusChange) -> Void)?
    var startResult = true
    private(set) var starts = 0
    private(set) var stops = 0

    func start(
        onInput: @escaping @Sendable (RawKeyInput, Int) -> Void,
        onStatus: @escaping @Sendable (TapStatusChange) -> Void
    ) -> Bool {
        lock.withLock {
            starts += 1
            guard startResult else { return false }
            self.onInput = onInput
            self.onStatus = onStatus
            return true
        }
    }

    func stop() {
        lock.withLock {
            stops += 1
            onInput = nil
            onStatus = nil
        }
    }

    func press(_ input: RawKeyInput, at: Int = 1000) {
        let handler = lock.withLock { onInput }
        handler?(input, at)
    }

    func status(_ change: TapStatusChange) {
        let handler = lock.withLock { onStatus }
        handler?(change)
    }
}

final class EmittedEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [Envelope] = []
    var all: [Envelope] { lock.withLock { items } }
    func append(_ envelope: Envelope) { lock.withLock { items.append(envelope) } }
    func clear() { lock.withLock { items.removeAll() } }
}

final class HotkeyControllerTests: XCTestCase {
    private let defaultPayload: [String: JSONValue] = [
        "bindings": .array([
            .object([
                "id": .string("dictate-hold"), "action": .string("dictate.hold"), "mode": .string("hold"),
                "trigger": .object(["type": .string("key"), "keyCode": .int(61), "modifiers": .array([])]),
            ])
        ])
    ]

    private func make(
        inputMonitoring: PermissionStatus = .granted
    ) -> (HotkeyController, FakeKeySource, EmittedEvents, FakePermissionProvider) {
        let source = FakeKeySource()
        let events = EmittedEvents()
        let permissions = FakePermissionProvider([.inputMonitoring: inputMonitoring])
        let controller = HotkeyController(source: source, permissions: permissions, emit: { events.append($0) })
        return (controller, source, events, permissions)
    }

    func testConfigureStartsTapAndReportsActive() {
        let (controller, source, events, _) = make()
        let result = controller.configure(defaultPayload)
        XCTAssertEqual(try result.get().registered, ["dictate-hold"])
        XCTAssertEqual(source.starts, 1)
        XCTAssertEqual(events.all, [HotkeyController.tapStatus(.active)])
        XCTAssertTrue(controller.isRunning)

        _ = controller.configure(defaultPayload)
        XCTAssertEqual(source.starts, 1, "a running tap is reused")
    }

    func testKeyEventsBecomeHotkeyEvents() {
        let (controller, source, events, _) = make()
        _ = controller.configure(defaultPayload)
        events.clear()
        source.press(.modifier(keyCode: 61, isDown: true), at: 1_794_316_800_100)
        source.press(.modifier(keyCode: 61, isDown: false), at: 1_794_316_801_350)
        XCTAssertEqual(events.all.map(\.type), ["hotkey.event", "hotkey.event"])
        XCTAssertEqual(events.all[0].payload, [
            "bindingId": .string("dictate-hold"), "action": .string("dictate.hold"),
            "state": .string("down"), "at": .int(1_794_316_800_100),
        ])
        XCTAssertEqual(events.all[1].payload["state"], .string("up"))
    }

    func testUnmatchedInputProducesNothing() {
        let (controller, source, events, _) = make()
        _ = controller.configure(defaultPayload)
        events.clear()
        // Ordinary typing, including Left Option and auto-repeat.
        for keyCode in 0..<50 {
            source.press(.keyDown(keyCode: keyCode, modifiers: [], isRepeat: false))
            source.press(.keyDown(keyCode: keyCode, modifiers: [.shift], isRepeat: true))
            source.press(.keyUp(keyCode: keyCode))
        }
        source.press(.modifier(keyCode: 58, isDown: true))
        source.press(.modifier(keyCode: 58, isDown: false))
        XCTAssertEqual(events.all, [])
    }

    func testPermissionMissingRefusesWithoutStartingTheTap() {
        let (controller, source, events, permissions) = make(inputMonitoring: .notDetermined)
        guard case .failure(.permissionDenied(let message)) = controller.configure(defaultPayload) else {
            return XCTFail("expected permissionDenied")
        }
        XCTAssertTrue(message.hasPrefix("inputMonitoring"))
        XCTAssertEqual(source.starts, 0)
        XCTAssertEqual(permissions.requests, [], "configure must never ask for a permission")
        XCTAssertEqual(events.all, [])

        permissions.set(.inputMonitoring, .granted)
        XCTAssertNoThrow(try controller.configure(defaultPayload).get())
        XCTAssertEqual(source.starts, 1)
    }

    func testTapThatCannotStartIsPermissionDenied() {
        let (controller, source, _, _) = make()
        source.startResult = false
        guard case .failure(.permissionDenied) = controller.configure(defaultPayload) else {
            return XCTFail("expected permissionDenied")
        }
        XCTAssertFalse(controller.isRunning)
    }

    func testDisabledTapReportsStatusAndReleasesHeldKey() {
        let (controller, source, events, _) = make()
        _ = controller.configure(defaultPayload)
        source.press(.modifier(keyCode: 61, isDown: true))
        events.clear()
        source.status(.disabledBySystem)
        source.status(.reenabled)
        XCTAssertEqual(events.all.map(\.type), ["hotkey.tap.status", "hotkey.event", "hotkey.tap.status"])
        XCTAssertEqual(events.all[0].payload["state"], .string("disabled_by_system"))
        XCTAssertEqual(events.all[1].payload["state"], .string("up"))
        XCTAssertEqual(events.all[2].payload["state"], .string("reenabled"))
    }

    func testEmptyBindingsStopTheTap() {
        let (controller, source, _, _) = make()
        _ = controller.configure(defaultPayload)
        XCTAssertEqual(try controller.configure(["bindings": .array([])]).get().registered, [])
        XCTAssertEqual(source.stops, 1)
        XCTAssertFalse(controller.isRunning)
    }

    func testStopStopsTheTap() {
        let (controller, source, _, _) = make()
        _ = controller.configure(defaultPayload)
        controller.stop()
        XCTAssertEqual(source.stops, 1)
        controller.stop()
        XCTAssertEqual(source.stops, 1)
    }
}

final class HotkeyRouterTests: XCTestCase {
    private func loadMessages(_ name: String) throws -> [JSONValue] {
        let data = try Data(contentsOf: fixtureURL(name))
        guard case .array(let messages)? = try JSONDecoder().decode(JSONValue.self, from: data).objectValue?["messages"] else {
            throw XCTSkip("no messages in \(name)")
        }
        return messages
    }

    private func router(inputMonitoring: PermissionStatus) -> MessageRouter {
        let permissions = FakePermissionProvider([.inputMonitoring: inputMonitoring])
        let hotkeys = HotkeyController(source: FakeKeySource(), permissions: permissions, emit: { _ in })
        var router = MessageRouter(permissions: permissions, hotkeys: hotkeys, uptimeMs: { 0 })
        _ = router.handle(line: line(validAck))
        return router
    }

    private func json(_ envelope: Envelope) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: EnvelopeCodec.encode(envelope))
    }

    func testRouterAnswersHotkeyFixtures() throws {
        let messages = try loadMessages("hotkey.configure.json")
        var granted = router(inputMonitoring: .granted)
        XCTAssertEqual(try json(granted.handle(line: JSONEncoder().encode(messages[0]))[0]), messages[1])
        XCTAssertEqual(try json(granted.handle(line: JSONEncoder().encode(messages[2]))[0]), messages[3])
        var denied = router(inputMonitoring: .denied)
        XCTAssertEqual(try json(denied.handle(line: JSONEncoder().encode(messages[4]))[0]), messages[5])
    }

    func testRouterWithoutHotkeysRefusesConfigure() {
        var router = handshaken()
        let reply = router.handle(line: line(#"{"id":"m-000002","type":"hotkey.configure","payload":{"bindings":[]}}"#))
        XCTAssertEqual(errorCode(reply[0]), "UNSUPPORTED_REQUEST")
    }

    func testMalformedConfigureIsInvalidPayload() {
        var router = router(inputMonitoring: .granted)
        let reply = router.handle(line: line(#"{"id":"m-000002","type":"hotkey.configure","payload":{"bindings":7}}"#))
        XCTAssertEqual(errorCode(reply[0]), "INVALID_PAYLOAD")
    }

    func testFixtureEventsMatchWhatTheControllerSends() throws {
        let messages = try loadMessages("hotkey.event.json")
        let binding = HotkeyFiring(binding: rightOptionHold, state: .down)
        XCTAssertEqual(try json(HotkeyController.event(binding, at: 1_794_316_800_100)), messages[0])
        XCTAssertEqual(try json(HotkeyController.tapStatus(.active)), messages[2])
        XCTAssertEqual(try json(HotkeyController.tapStatus(.disabledBySystem)), messages[3])
    }
}

final class EventClockTests: XCTestCase {
    // Apple silicon timebase: 125/3 ns per tick.
    private let numer: UInt32 = 125
    private let denom: UInt32 = 3
    private let nowEpoch = 1_794_316_800_000

    func testTimestampInTicks() {
        let nowTicks: UInt64 = 4_380_151_640_546
        let eventTicks = nowTicks - 240  // 240 ticks = 10 microseconds ago
        XCTAssertEqual(
            EventClock.epochMs(eventTimestamp: eventTicks, nowTicks: nowTicks, numer: numer, denom: denom, nowEpochMs: nowEpoch),
            nowEpoch)
        let thirtyMsAgo = nowTicks - 720_000  // 720,000 ticks = 30 ms
        XCTAssertEqual(
            EventClock.epochMs(eventTimestamp: thirtyMsAgo, nowTicks: nowTicks, numer: numer, denom: denom, nowEpochMs: nowEpoch),
            nowEpoch - 30)
    }

    func testTimestampInNanoseconds() {
        let nowTicks: UInt64 = 4_380_151_640_546
        let nowNs = nowTicks * 125 / 3
        XCTAssertEqual(
            EventClock.epochMs(eventTimestamp: nowNs - 12_000_000, nowTicks: nowTicks, numer: numer, denom: denom, nowEpochMs: nowEpoch),
            nowEpoch - 12)
    }

    func testIntelTimebase() {
        XCTAssertEqual(
            EventClock.epochMs(eventTimestamp: 9_000_000_000, nowTicks: 9_005_000_000, numer: 1, denom: 1, nowEpochMs: nowEpoch),
            nowEpoch - 5)
    }

    func testZeroOrStaleTimestampIsNil() {
        XCTAssertNil(EventClock.epochMs(eventTimestamp: 0, nowTicks: 1_000_000, numer: 1, denom: 1, nowEpochMs: nowEpoch))
        XCTAssertNil(
            EventClock.epochMs(eventTimestamp: 1, nowTicks: 60_000_000_000, numer: 1, denom: 1, nowEpochMs: nowEpoch))
    }
}

final class EscapeCancelTests: XCTestCase {
    private func binding(action: String) -> JSONValue {
        .object([
            "id": .string("b"), "action": .string(action), "mode": .string("press"),
            "trigger": .object(["type": .string("key"), "keyCode": .int(53), "modifiers": .array([])]),
        ])
    }

    func testEscapeAloneIsAllowedOnlyForCancel() {
        XCTAssertEqual(try? HotkeyMatcher.parseBinding(binding(action: "dictate.cancel")).get().trigger.keyCode, 53)
        guard case .failure(let problem) = HotkeyMatcher.parseBinding(binding(action: "paste.last")) else {
            return XCTFail("Escape alone was accepted for another action")
        }
        XCTAssertEqual(problem.text, "This key needs at least one modifier")
    }
}
