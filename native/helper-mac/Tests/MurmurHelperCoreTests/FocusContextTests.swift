import Foundation
import XCTest

@testable import MurmurHelperCore

final class ContextWindowTests: XCTestCase {
    func testTakesTheTextAroundTheCaret() {
        let (before, after) = ContextWindow.slice("Hello Priya, see you soon", caret: 11, before: 100, after: 100)
        XCTAssertEqual(before, "Hello Priya")
        XCTAssertEqual(after, ", see you soon")
    }

    func testKeepsOnlyTheNearestCharacters() {
        let text = String(repeating: "a", count: 50) + "|" + String(repeating: "b", count: 50)
        let (before, after) = ContextWindow.slice(text, caret: 50, before: 10, after: 5)
        XCTAssertEqual(before, String(repeating: "a", count: 10))
        XCTAssertEqual(after, "|bbbb")
    }

    func testNoCaretMeansTheEnd() {
        let (before, after) = ContextWindow.slice("abc", caret: nil, before: 2, after: 5)
        XCTAssertEqual(before, "bc")
        XCTAssertEqual(after, "")
    }

    func testNeverSplitsAnEmojiOrAnOutOfRangeCaret() {
        // "😀" is two UTF-16 units; a window starting inside it drops it.
        let (before, _) = ContextWindow.slice("x😀yz", caret: 5, before: 3, after: 0)
        XCTAssertEqual(before, "yz")
        let (head, tail) = ContextWindow.slice("abc", caret: 99, before: 10, after: 10)
        XCTAssertEqual(head, "abc")
        XCTAssertEqual(tail, "")
    }
}

private struct FakeReader: FocusContextReader {
    var context: FocusContext?
    func read(maxBefore: Int, maxAfter: Int) -> FocusContext? { context }
}

final class ContextControllerTests: XCTestCase {
    private func run(_ context: FocusContext?, accessibility: PermissionStatus = .granted, payload: [String: JSONValue] = [:])
        -> (Envelope?, EmittedEvents)
    {
        let events = EmittedEvents()
        let controller = ContextController(
            reader: FakeReader(context: context), permissions: FakePermissionProvider([.accessibility: accessibility]),
            reply: { events.append($0) })
        return (controller.snapshot(id: "m-1", payload: payload), events)
    }

    func testReturnsTheFocusedField() throws {
        let (immediate, events) = run(
            FocusContext(appName: "Slack", bundleId: "com.tinyspeck.slackmacgap", role: "AXTextArea", editable: true,
                textBefore: "Hi Priya Raghunathan"))
        XCTAssertNil(immediate)
        waitForReplies(events, count: 1)
        let result = try XCTUnwrap(events.all.first?.payload["result"]?.objectValue)
        XCTAssertEqual(result["textBefore"], .string("Hi Priya Raghunathan"))
        XCTAssertEqual(result["secure"], .bool(false))
        XCTAssertEqual(result["bundleId"], .string("com.tinyspeck.slackmacgap"))
    }

    func testASecureFieldNeverGivesText() throws {
        let (_, events) = run(
            FocusContext(role: "AXTextField", subrole: "AXSecureTextField", textBefore: "hunter2", textAfter: "x"))
        waitForReplies(events, count: 1)
        let result = try XCTUnwrap(events.all.first?.payload["result"]?.objectValue)
        XCTAssertEqual(result["secure"], .bool(true))
        XCTAssertEqual(result["textBefore"], .string(""))
        XCTAssertEqual(result["textAfter"], .string(""))
    }

    func testNeedsAccessibilityAndReadsNothingWithoutIt() {
        let (reply, events) = run(FocusContext(textBefore: "x"), accessibility: .denied)
        XCTAssertEqual(reply.flatMap(errorCode), "PERMISSION_DENIED")
        XCTAssertTrue(events.all.isEmpty)
    }

    func testNoFocusedElementIsContextUnavailable() {
        let (_, events) = run(nil)
        waitForReplies(events, count: 1)
        XCTAssertEqual(events.all.first.flatMap(errorCode), "CONTEXT_UNAVAILABLE")
    }

    func testRefusesLimitsAboveTheMaximum() {
        let (reply, _) = run(FocusContext(), payload: ["maxBefore": .int(5_000)])
        XCTAssertEqual(reply.flatMap(errorCode), "INVALID_PAYLOAD")
    }
}
