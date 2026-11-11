import Foundation
import XCTest

@testable import MurmurHelperCore

final class EditDiffTests: XCTestCase {
    func testFindsTheLastPlaceTheTextWasInserted() {
        XCTAssertEqual(EditDiff.locate("hi", in: "hi there, hi"), 10..<12)
        XCTAssertNil(EditDiff.locate("bye", in: "hi"))
    }

    func testReportsOnlyTheChangedWords() {
        let old = "Note: Deploy it to Kube net is today. Done"
        let span = EditDiff.locate("Deploy it to Kube net is today.", in: old)!
        let new = "Note: Deploy it to Kubernetes today. Done"
        let change = EditDiff.change(old: old, span: span, new: new)
        XCTAssertEqual(change?.before, "Kube net is")
        XCTAssertEqual(change?.after, "Kubernetes")
        XCTAssertEqual(change.map { String(Array(new)[$0.span]) }, "Deploy it to Kubernetes today.")
    }

    func testGivesUpWhenTextOutsideTheSpanChanged() {
        let old = "Hi. Send it now."
        let span = EditDiff.locate("Send it now.", in: old)!
        XCTAssertNil(EditDiff.change(old: old, span: span, new: "Hello. Send it now."))
        XCTAssertNil(EditDiff.change(old: old, span: span, new: old))
    }

    func testHandlesEmojiAndAccents() {
        let old = "😀 café ok"
        let span = EditDiff.locate("café ok", in: old)!
        XCTAssertEqual(EditDiff.change(old: old, span: span, new: "😀 Café ok")?.after, "Café")
    }
}

private final class FakeField: WatchedField, @unchecked Sendable {
    private let lock = NSLock()
    private var text: String
    private var focused = true
    init(_ text: String) { self.text = text }
    func value() -> String? { lock.withLock { text } }
    func isFocused() -> Bool { lock.withLock { focused } }
    func set(_ value: String) { lock.withLock { text = value } }
    func blur() { lock.withLock { focused = false } }
}

private struct FakeSource: WatchedFieldSource {
    let field: FakeField?
    func focusedField() -> (any WatchedField)? { field }
}

final class EditWatchControllerTests: XCTestCase {
    private func make(_ field: FakeField?, accessibility: PermissionStatus = .granted) -> (EditWatchController, EmittedEvents) {
        let events = EmittedEvents()
        let controller = EditWatchController(
            source: FakeSource(field: field), permissions: FakePermissionProvider([.accessibility: accessibility]),
            emit: { events.append($0) }, pollSeconds: 0.01, restPolls: 2)
        return (controller, events)
    }

    private func watch(_ controller: EditWatchController, _ text: String) -> Envelope {
        controller.handle(id: "m-1", type: "edits.watch", payload: ["text": .string(text), "durationMs": .int(1_000)])
    }

    func testSendsTheCorrectionOnceItRests() {
        let field = FakeField("Deploy to kube net is today.")
        let (controller, events) = make(field)
        XCTAssertEqual(watch(controller, "Deploy to kube net is today.").payload["result"]?.objectValue?["watching"], .bool(true))
        field.set("Deploy to Kubernetes today.")
        waitForReplies(events, count: 1)
        XCTAssertEqual(events.all.first?.type, "edits.changed")
        XCTAssertEqual(events.all.first?.payload["before"], .string("kube net is"))
        XCTAssertEqual(events.all.first?.payload["after"], .string("Kubernetes"))
    }

    func testDoesNotWatchWithoutTheTextOrAccessibility() {
        let (missing, _) = make(FakeField("something else"))
        XCTAssertEqual(watch(missing, "hello").payload["result"]?.objectValue?["watching"], .bool(false))
        let (denied, _) = make(FakeField("hello"), accessibility: .denied)
        XCTAssertEqual(watch(denied, "hello").payload["result"]?.objectValue?["watching"], .bool(false))
        let (secure, _) = make(nil)
        XCTAssertEqual(watch(secure, "hello").payload["result"]?.objectValue?["watching"], .bool(false))
    }

    func testStopsOnFocusChangeAndCancel() {
        let field = FakeField("one two")
        let (controller, events) = make(field)
        _ = watch(controller, "one two")
        field.blur()
        field.set("one three")
        Thread.sleep(forTimeInterval: 0.15)
        XCTAssertEqual(events.all.count, 0)
        let other = FakeField("one two")
        let (cancelled, cancelledEvents) = make(other)
        _ = watch(cancelled, "one two")
        XCTAssertEqual(
            cancelled.handle(id: "m-2", type: "edits.cancel", payload: [:]).payload["result"]?.objectValue?["cancelled"],
            .bool(true))
        other.set("one three")
        Thread.sleep(forTimeInterval: 0.15)
        XCTAssertEqual(cancelledEvents.all.count, 0)
    }

    func testRefusesABadWatch() {
        let (controller, _) = make(FakeField("x"))
        let reply = controller.handle(id: "m-1", type: "edits.watch", payload: ["text": .string("x"), "durationMs": .int(90_000)])
        XCTAssertEqual(reply.payload["ok"], .bool(false))
    }
}
