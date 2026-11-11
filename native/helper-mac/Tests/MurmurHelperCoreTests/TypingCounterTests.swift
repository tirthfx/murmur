import Foundation
import XCTest

@testable import MurmurHelperCore

final class TypingCounterTests: XCTestCase {
    private func type(_ keys: [Int], into counter: inout TypingCounter, modifiers: Set<HotkeyModifier> = []) {
        for key in keys { counter.handle(.keyDown(keyCode: key, modifiers: modifiers, isRepeat: false)) }
    }

    func testCountsWordsAtSeparators() {
        var counter = TypingCounter()
        // "hi you" + space, "ok" + return: three words.
        type([4, 34, 49, 16, 31, 32, 49, 31, 40, 36], into: &counter)
        XCTAssertEqual(counter.take(), 3)
        XCTAssertEqual(counter.take(), 0)
    }

    func testRepeatedSpacesEditingKeysAndShortcutsAreNotWords() {
        var counter = TypingCounter()
        type([49, 49, 51, 51, 123, 124, 53, 49], into: &counter)
        type([9, 49], into: &counter, modifiers: [.command])
        counter.handle(.keyDown(keyCode: 4, modifiers: [], isRepeat: true))
        counter.handle(.keyUp(keyCode: 4))
        counter.handle(.mouseDown(button: 3))
        XCTAssertEqual(counter.take(), 0)
    }

    func testShiftedLettersCount() {
        var counter = TypingCounter()
        type([4], into: &counter, modifiers: [.shift])
        type([49], into: &counter)
        XCTAssertEqual(counter.words, 1)
    }
}

final class TypingWatchTests: XCTestCase {
    func testCountsOnlyWhileWatchingAndReportsOnlyNumbers() throws {
        let source = FakeKeySource()
        let events = EmittedEvents()
        let controller = HotkeyController(
            source: source, permissions: FakePermissionProvider([.inputMonitoring: .granted]),
            emit: { events.append($0) })
        _ = controller.configure([
            "bindings": .array([
                .object([
                    "id": .string("hold"), "action": .string("dictate.hold"), "mode": .string("hold"),
                    "trigger": .object(["type": .string("key"), "keyCode": .int(61), "modifiers": .array([])]),
                ])
            ])
        ])
        source.press(.keyDown(keyCode: 4, modifiers: [], isRepeat: false))
        source.press(.keyDown(keyCode: 49, modifiers: [], isRepeat: false))
        controller.reportTyping(periodMs: 30_000)
        XCTAssertNil(events.all.first { $0.type == "typing.activity" }, "not watching yet")

        controller.watchTyping(true, interval: 3_600)
        for key in [4, 34, 49, 16, 49] { source.press(.keyDown(keyCode: key, modifiers: [], isRepeat: false)) }
        controller.reportTyping(periodMs: 30_000)
        let activity = try XCTUnwrap(events.all.first { $0.type == "typing.activity" })
        XCTAssertEqual(activity.payload, ["words": .int(2), "periodMs": .int(30_000)])

        controller.watchTyping(false)
        XCTAssertFalse(controller.isWatchingTyping)
        source.press(.keyDown(keyCode: 4, modifiers: [], isRepeat: false))
        source.press(.keyDown(keyCode: 49, modifiers: [], isRepeat: false))
        controller.reportTyping(periodMs: 30_000)
        XCTAssertEqual(events.all.filter { $0.type == "typing.activity" }.count, 1)
    }
}
