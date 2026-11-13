import Foundation
import XCTest

@testable import MurmurHelperCore

struct FakeSelectionReader: SelectionReader {
    var answer: AXSelection
    func read(maxLength: Int) -> AXSelection { answer }
}

/// Replies sent later from a task, with a bounded wait for them.
final class Replies: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [Envelope] = []
    func add(_ envelope: Envelope) { lock.withLock { items.append(envelope) } }
    func wait(count: Int, timeout: Double = 2) -> [Envelope] {
        let deadline = Date().addingTimeInterval(timeout)
        while lock.withLock({ items.count }) < count, Date() < deadline { Thread.sleep(forTimeInterval: 0.005) }
        return lock.withLock { items }
    }
}

private let note: [String: Data] = ["public.utf8-plain-text": Data("kept note".utf8)]

/// A board and keys where Command+C copies `copied`, as the app in front would.
private func copying(_ copied: String?) -> (FakePasteboard, FakeKeys) {
    let board = FakePasteboard([note])
    let keys = FakeKeys()
    if let copied {
        keys.onKey = { code, modifiers in
            if code == SelectionReading.keyC, modifiers == .command { board.userCopies(copied) }
        }
    }
    return (board, keys)
}

private func reading(_ answer: AXSelection, board: FakePasteboard, keys: FakeKeys) -> SelectionReading {
    SelectionReading(reader: FakeSelectionReader(answer: answer), pasteboard: board, keys: keys, sleep: { _ in })
}

final class SelectionTests: XCTestCase {
    func testAccessibilityTextComesBackWithItsRangeAndHash() async {
        let (board, keys) = copying(nil)
        let outcome = await reading(.selected(text: "the quarterly numbers", location: 12, length: 21), board: board, keys: keys)
            .read(fallback: true, clipboardFirst: false, copyWait: 0.25)
        XCTAssertEqual(outcome.status, .ok)
        XCTAssertEqual(outcome.text, "the quarterly numbers")
        XCTAssertEqual(outcome.source, .ax)
        XCTAssertEqual(outcome.range?.location, 12)
        XCTAssertEqual(outcome.hash.count, 64)
        XCTAssertTrue(keys.keyPresses.isEmpty, "nothing is copied when Accessibility answers")
    }

    func testHashIsSha256OfTheUtf8Text() {
        let outcome = SelectionOutcome(status: .ok, text: "abc", length: 3, source: .ax)
        XCTAssertEqual(outcome.hash, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertEqual(SelectionOutcome(status: .empty).hash, "")
    }

    func testAnEmptySelectionIsEmptyAndNotCopied() async {
        let (board, keys) = copying("whole line")
        let outcome = await reading(.selected(text: "", location: 4, length: 0), board: board, keys: keys)
            .read(fallback: true, clipboardFirst: false, copyWait: 0.25)
        XCTAssertEqual(outcome.status, .empty)
        XCTAssertTrue(keys.keyPresses.isEmpty)
    }

    func testOverTheLimitIsRefusedWithItsLength() async {
        let (board, keys) = copying(nil)
        let outcome = await reading(.selected(text: nil, location: 0, length: 9_000), board: board, keys: keys)
            .read(fallback: true, clipboardFirst: false, copyWait: 0.25)
        XCTAssertEqual(outcome.status, .tooLong)
        XCTAssertEqual(outcome.length, 9_000)
        XCTAssertEqual(outcome.text, "")
    }

    func testASecureFieldIsNeverCopied() async {
        let (board, keys) = copying("secret")
        let outcome = await reading(.secure, board: board, keys: keys)
            .read(fallback: true, clipboardFirst: true, copyWait: 0.25)
        XCTAssertEqual(outcome.status, .secure)
        XCTAssertTrue(keys.keyPresses.isEmpty)
    }

    func testUnsupportedFallsBackToACopyAndRestoresTheClipboard() async {
        let (board, keys) = copying("from the doc")
        let outcome = await reading(.unsupported, board: board, keys: keys)
            .read(fallback: true, clipboardFirst: false, copyWait: 0.25)
        XCTAssertEqual(outcome.status, .ok)
        XCTAssertEqual(outcome.text, "from the doc")
        XCTAssertEqual(outcome.source, .clipboard)
        XCTAssertNil(outcome.range)
        XCTAssertEqual(board.items, [note], "the user's clipboard is back")
        XCTAssertEqual(keys.keyPresses.count, 1)
        XCTAssertEqual(keys.keyPresses.first?.1, .command)
    }

    func testARangeWithoutTextIsCopied() async {
        let (board, keys) = copying("copied")
        let outcome = await reading(.selected(text: nil, location: 3, length: 6), board: board, keys: keys)
            .read(fallback: true, clipboardFirst: false, copyWait: 0.25)
        XCTAssertEqual(outcome.source, .clipboard)
        XCTAssertEqual(outcome.text, "copied")
    }

    func testClipboardFirstSkipsAccessibilityText() async {
        let (board, keys) = copying("real text")
        let outcome = await reading(.selected(text: "", location: 0, length: 0), board: board, keys: keys)
            .read(fallback: true, clipboardFirst: true, copyWait: 0.25)
        XCTAssertEqual(outcome.text, "real text")
        XCTAssertEqual(outcome.source, .clipboard)
    }

    func testACopyThatChangesNothingIsEmpty() async {
        let (board, keys) = copying(nil)
        let waits = Waits()
        let outcome = await SelectionReading(
            reader: FakeSelectionReader(answer: .unsupported), pasteboard: board, keys: keys, sleep: { waits.add($0) }
        ).read(fallback: true, clipboardFirst: false, copyWait: 0.1)
        XCTAssertEqual(outcome.status, .empty)
        XCTAssertEqual(board.items, [note])
        XCTAssertLessThanOrEqual(waits.all.count, 6, "it stops waiting after copyWait")
    }

    func testWithoutFallbackUnsupportedIsUnavailable() async {
        let (board, keys) = copying("x")
        let outcome = await reading(.noFocus, board: board, keys: keys)
            .read(fallback: false, clipboardFirst: false, copyWait: 0.25)
        XCTAssertEqual(outcome.status, .unavailable)
        XCTAssertTrue(keys.keyPresses.isEmpty)
    }

    func testALongCopyIsTooLong() async {
        let (board, keys) = copying(String(repeating: "a", count: 8_001))
        let outcome = await reading(.unsupported, board: board, keys: keys)
            .read(fallback: true, clipboardFirst: false, copyWait: 0.25)
        XCTAssertEqual(outcome.status, .tooLong)
        XCTAssertEqual(outcome.length, 8_001)
        XCTAssertEqual(board.items, [note])
    }

    func testControllerNeedsAccessibilityAndAnswersLater() {
        let (board, keys) = copying(nil)
        let replies = Replies()
        let denied = SelectionController(
            reading: reading(.unsupported, board: board, keys: keys), permissions: FakePermissionProvider(),
            frontmostBundleId: { "com.apple.Notes" }, reply: replies.add)
        XCTAssertEqual(denied.handle(id: "m-1", payload: [:]).flatMap(errorCode), "PERMISSION_DENIED")

        let granted = SelectionController(
            reading: reading(.selected(text: "hi", location: 0, length: 2), board: board, keys: keys),
            permissions: FakePermissionProvider([.accessibility: .granted]),
            frontmostBundleId: { "com.apple.Notes" }, reply: replies.add)
        XCTAssertEqual(
            granted.handle(id: "m-2", payload: ["copyWaitMs": .int(5)]).flatMap(errorCode), "INVALID_PAYLOAD")
        XCTAssertNil(granted.handle(id: "m-3", payload: [:]))
        let reply = replies.wait(count: 1).first
        let result = reply?.payload["result"]?.objectValue
        XCTAssertEqual(result?["status"]?.stringValue, "ok")
        XCTAssertEqual(result?["text"]?.stringValue, "hi")
        XCTAssertEqual(result?["source"]?.stringValue, "ax")
        XCTAssertEqual(result?["appBundleId"]?.stringValue, "com.apple.Notes")
        XCTAssertEqual(result?["range"]?.objectValue?["length"]?.intValue, 2)
    }

    func testRouterSendsSelectionReadToTheController() {
        let (board, keys) = copying(nil)
        let replies = Replies()
        let permissions = FakePermissionProvider([.accessibility: .granted])
        var router = MessageRouter(
            permissions: permissions,
            selection: SelectionController(
                reading: reading(.secure, board: board, keys: keys), permissions: permissions,
                frontmostBundleId: { nil }, reply: replies.add),
            uptimeMs: { 0 })
        _ = router.handle(line: line(validAck))
        let direct = router.handle(line: line(#"{"id":"m-000110","type":"selection.read","payload":{}}"#))
        XCTAssertTrue(direct.isEmpty)
        XCTAssertEqual(replies.wait(count: 1).first?.payload["result"]?.objectValue?["status"]?.stringValue, "secure")
    }

    func testFixtureMatchesTheProtocol() throws {
        let data = try Data(contentsOf: fixtureURL("selection.json"))
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let types = (object?["messages"] as? [[String: Any]])?.compactMap { $0["type"] as? String } ?? []
        XCTAssertTrue(types.contains("selection.read"))
        XCTAssertTrue(types.contains("keys.press"))
    }
}

final class KeysTests: XCTestCase {
    private func controller(_ keys: FakeKeys, front: String? = "com.apple.Notes", granted: Bool = true) -> KeysController {
        KeysController(
            keys: keys, permissions: FakePermissionProvider(granted ? [.accessibility: .granted] : [:]),
            frontmostBundleId: { front })
    }

    func testBoldIsPressedWithCommand() {
        let keys = FakeKeys()
        let reply = controller(keys).press(
            id: "m-1", payload: ["key": .string("b"), "modifiers": .array([.string("command")])])
        XCTAssertEqual(reply.payload["result"]?.objectValue?["pressed"]?.boolValue, true)
        XCTAssertEqual(keys.keyPresses.first?.0, 11)
        XCTAssertEqual(keys.keyPresses.first?.1, .command)
    }

    func testKeysOffTheListAndBadCombinationsAreRefused() {
        let keys = FakeKeys()
        let c = controller(keys)
        let cases: [[String: JSONValue]] = [
            ["key": .string("q"), "modifiers": .array([.string("command")])],
            ["key": .string("a"), "modifiers": .array([.string("control")])],
            ["key": .string("b"), "modifiers": .array([])],
            ["key": .string("return"), "modifiers": .array([.string("command")])],
            ["key": .string("left"), "modifiers": .array([.string("control")])],
            ["key": .string("left"), "modifiers": .array([.string("shift"), .string("shift")])],
            ["key": .string("left"), "modifiers": .array([]), "repeat": .int(500)],
        ]
        for payload in cases {
            XCTAssertEqual(errorCode(c.press(id: "m-1", payload: payload)), "INVALID_PAYLOAD", "\(payload)")
        }
        XCTAssertTrue(keys.keyPresses.isEmpty)
    }

    func testTheRuleMatchesTheSharedOne() {
        XCTAssertTrue(KeysController.allowed("z", [.command, .shift]))
        XCTAssertTrue(KeysController.allowed("left", [.shift, .option]))
        XCTAssertTrue(KeysController.allowed("return", .shift))
        XCTAssertTrue(KeysController.allowed("delete", []))
        XCTAssertFalse(KeysController.allowed("delete", .command))
        XCTAssertFalse(KeysController.allowed("z", [.command, .option]))
        XCTAssertFalse(KeysController.allowed("left_bracket", [.command, .shift]))
    }

    func testOnlyInAnotherAppSendsNothing() {
        let keys = FakeKeys()
        let reply = controller(keys, front: "com.apple.Mail").press(
            id: "m-1",
            payload: ["key": .string("left"), "modifiers": .array([.string("shift")]), "onlyInApp": .string("com.apple.Notes")])
        XCTAssertEqual(reply.payload["result"]?.objectValue?["pressed"]?.boolValue, false)
        XCTAssertTrue(keys.keyPresses.isEmpty)
    }

    func testRepeatPressesThatManyTimes() {
        let keys = FakeKeys()
        _ = controller(keys).press(id: "m-1", payload: ["key": .string("left"), "modifiers": .array([]), "repeat": .int(12)])
        XCTAssertEqual(keys.keyPresses.count, 12)
    }

    func testNeedsAccessibility() {
        let keys = FakeKeys()
        let reply = controller(keys, granted: false).press(
            id: "m-1", payload: ["key": .string("return"), "modifiers": .array([])])
        XCTAssertEqual(errorCode(reply), "PERMISSION_DENIED")
        XCTAssertTrue(keys.keyPresses.isEmpty)
    }
}
