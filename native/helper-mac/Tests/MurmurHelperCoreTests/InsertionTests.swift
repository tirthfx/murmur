import AppKit
import Foundation
import XCTest

@testable import MurmurHelperCore

final class FakePasteboard: PasteboardAccess, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private var contents: [[String: Data]]
    private(set) var transientWrites: [String] = []

    init(_ contents: [[String: Data]] = []) { self.contents = contents }

    var changeCount: Int { lock.withLock { count } }
    var items: [[String: Data]] { lock.withLock { contents } }

    func snapshot() -> PasteboardSnapshot { lock.withLock { PasteboardSnapshot(items: contents) } }

    func writeTransientText(_ text: String) -> Int {
        lock.withLock {
            transientWrites.append(text)
            contents = [["public.utf8-plain-text": Data(text.utf8), "org.nspasteboard.TransientType": Data()]]
            count += 1
            return count
        }
    }

    func writeText(_ text: String) {
        lock.withLock {
            contents = [["public.utf8-plain-text": Data(text.utf8)]]
            count += 1
        }
    }

    func restore(_ snapshot: PasteboardSnapshot) {
        lock.withLock {
            contents = snapshot.items
            count += 1
        }
    }

    /// What the user does when they copy something.
    func userCopies(_ text: String) { writeText(text) }
}

final class FakeKeys: KeyPoster, @unchecked Sendable {
    private let lock = NSLock()
    var pasteWorks = true
    /// Chunk posts that fail, in order (true = fail).
    var failures: [Bool] = []
    private(set) var pastes = 0
    private(set) var typed: [String] = []

    func postPaste() -> Bool {
        lock.withLock {
            pastes += 1
            return pasteWorks
        }
    }

    func postText(_ chunk: String) -> Bool {
        lock.withLock {
            let fail = failures.isEmpty ? false : failures.removeFirst()
            if !fail { typed.append(chunk) }
            return !fail
        }
    }
}

/// Records the waits an inserter asks for.
final class Waits: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [Double] = []
    var all: [Double] { lock.withLock { items } }
    func add(_ value: Double) { lock.withLock { items.append(value) } }
}

private let image: [String: Data] = ["public.png": Data([0x89, 0x50, 0x4E, 0x47]), "public.tiff": Data([1, 2, 3])]
private let note: [String: Data] = ["public.utf8-plain-text": Data("old note".utf8), "public.rtf": Data("{\\rtf1}".utf8)]

final class InserterTests: XCTestCase {
    func testPasteRestoresEverythingThatWasThereIncludingAnImage() async {
        let board = FakePasteboard([image, note])
        let keys = FakeKeys()
        let waited = Waits()
        let inserter = Inserter(pasteboard: board, keys: keys, sleep: { waited.add($0) })
        let outcome = await inserter.paste("Hello", restore: true, restoreDelay: 0.35)
        XCTAssertEqual(outcome, InsertOutcome(method: .pasteCommandV, delivered: true, clipboardRestored: true))
        XCTAssertEqual(board.items, [image, note])
        XCTAssertEqual(board.transientWrites, ["Hello"])
        XCTAssertEqual(keys.pastes, 1)
        XCTAssertEqual(waited.all, [0.35])
    }

    func testACopyDuringTheWaitIsKept() async {
        let board = FakePasteboard([note])
        let inserter = Inserter(pasteboard: board, keys: FakeKeys(), sleep: { _ in board.userCopies("user copy") })
        let outcome = await inserter.paste("Hello", restore: true, restoreDelay: 0.35)
        XCTAssertEqual(outcome?.clipboardRestored, false)
        XCTAssertEqual(board.items, [["public.utf8-plain-text": Data("user copy".utf8)]])
    }

    func testAnEmptyPasteboardIsLeftEmpty() async {
        let board = FakePasteboard([])
        let inserter = Inserter(pasteboard: board, keys: FakeKeys(), sleep: { _ in })
        let outcome = await inserter.paste("Hello", restore: true, restoreDelay: 0.35)
        XCTAssertEqual(outcome?.clipboardRestored, true)
        XCTAssertEqual(board.items, [])
    }

    func testWithoutRestoreTheTextStaysAndNothingWaits() async {
        let board = FakePasteboard([note])
        let waited = Waits()
        let inserter = Inserter(pasteboard: board, keys: FakeKeys(), sleep: { waited.add($0) })
        let outcome = await inserter.paste("Hello", restore: false, restoreDelay: 0.35)
        XCTAssertEqual(outcome, InsertOutcome(method: .pasteCommandV, delivered: true, clipboardRestored: nil))
        XCTAssertEqual(waited.all, [])
    }

    func testFailedPastePutsTheClipboardBackAtOnce() async {
        let board = FakePasteboard([note])
        let keys = FakeKeys()
        keys.pasteWorks = false
        let inserter = Inserter(pasteboard: board, keys: keys, sleep: { _ in })
        let outcome = await inserter.paste("Hello", restore: true, restoreDelay: 0.35)
        XCTAssertNil(outcome)
        XCTAssertEqual(board.items, [note])
    }

    func testChunksNeverSplitAccentsOrEmoji() {
        let text = "Café déjà vu 👨‍👩‍👧‍👦 naïve résumé 🇮🇳 ok"
        let chunks = Inserter.chunks(text)
        XCTAssertEqual(chunks.joined(), text)
        for chunk in chunks { XCTAssertLessThanOrEqual(chunk.utf16.count, 20, chunk) }
        XCTAssertTrue(chunks.contains { $0.contains("👨‍👩‍👧‍👦") })
        XCTAssertEqual(Inserter.chunks(""), [])
        XCTAssertEqual(Inserter.chunks(String(repeating: "a", count: 45)).map(\.count), [20, 20, 5])
    }

    func testTypingRetriesAFailedChunkOnce() async {
        let keys = FakeKeys()
        keys.failures = [false, true, false]
        let gaps = Waits()
        let inserter = Inserter(pasteboard: FakePasteboard(), keys: keys, sleep: { gaps.add($0) })
        let ok = await inserter.type(String(repeating: "b", count: 30))
        XCTAssertTrue(ok)
        XCTAssertEqual(keys.typed, [String(repeating: "b", count: 20), String(repeating: "b", count: 10)])
        XCTAssertTrue(gaps.all.allSatisfy { $0 == 0.004 })
    }

    func testTypingGivesUpAfterTheRetryFails() async {
        let keys = FakeKeys()
        keys.failures = [true, true]
        let inserter = Inserter(pasteboard: FakePasteboard(), keys: keys, sleep: { _ in })
        let ok = await inserter.type("hello")
        XCTAssertFalse(ok)
    }
}

final class InsertionControllerTests: XCTestCase {
    private func make(
        accessibility: PermissionStatus = .granted, frontmost: String? = "com.apple.TextEdit",
        board: FakePasteboard = FakePasteboard([note]), keys: FakeKeys = FakeKeys()
    ) -> (InsertionController, FakePasteboard, FakeKeys, EmittedEvents) {
        let events = EmittedEvents()
        let controller = InsertionController(
            inserter: Inserter(pasteboard: board, keys: keys, sleep: { _ in }), pasteboard: board,
            permissions: FakePermissionProvider([.accessibility: accessibility]), frontmostBundleId: { frontmost },
            reply: { events.append($0) })
        return (controller, board, keys, events)
    }

    private func insert(_ text: String, method: String = "auto") -> [String: JSONValue] {
        ["text": .string(text), "method": .string(method), "restoreClipboard": .bool(true), "restoreDelayMs": .int(350)]
    }

    func testPastesAndReportsTheRestore() throws {
        let (controller, board, _, events) = make()
        XCTAssertNil(controller.handle(id: "m-1", type: "insert.text", payload: insert("Hello there.")))
        waitForReplies(events, count: 1)
        let result = try XCTUnwrap(events.all.first?.payload["result"]?.objectValue)
        XCTAssertEqual(result, ["method": .string("paste_cmd_v"), "delivered": .bool(true), "clipboardRestored": .bool(true)])
        XCTAssertEqual(board.items, [note])
    }

    func testFallsBackToTypingWhenPasteFails() throws {
        let keys = FakeKeys()
        keys.pasteWorks = false
        let (controller, _, _, events) = make(keys: keys)
        XCTAssertNil(controller.handle(id: "m-1", type: "insert.text", payload: insert("Grüße 😀")))
        waitForReplies(events, count: 1)
        XCTAssertEqual(events.all.first?.payload["result"]?.objectValue?["method"], .string("keystrokes"))
        XCTAssertEqual(keys.typed.joined(), "Grüße 😀")
    }

    func testRemoteDesktopAppsAreTyped() {
        let (controller, board, keys, events) = make(frontmost: "com.microsoft.rdc.macos")
        XCTAssertNil(controller.handle(id: "m-1", type: "insert.text", payload: insert("hi")))
        waitForReplies(events, count: 1)
        XCTAssertEqual(keys.pastes, 0)
        XCTAssertEqual(keys.typed, ["hi"])
        XCTAssertEqual(board.transientWrites, [])
    }

    func testMissingAccessibilityTouchesNothing() {
        for status in [PermissionStatus.denied, .notDetermined, .unknown] {
            let (controller, board, keys, _) = make(accessibility: status)
            let reply = controller.handle(id: "m-1", type: "insert.text", payload: insert("hi"))
            XCTAssertEqual(reply.flatMap(errorCode), "PERMISSION_DENIED")
            XCTAssertEqual(board.changeCount, 0)
            XCTAssertEqual(keys.pastes, 0)
        }
    }

    func testEmptyTextDoesNothing() {
        let (controller, board, keys, _) = make()
        let reply = controller.handle(id: "m-1", type: "insert.text", payload: insert(""))
        XCTAssertEqual(reply?.payload["result"]?.objectValue?["delivered"], .bool(false))
        XCTAssertEqual(board.changeCount, 0)
        XCTAssertEqual(keys.pastes, 0)
    }

    func testTypingFailureIsPasteFailed() {
        let keys = FakeKeys()
        keys.failures = [true, true]
        let (controller, _, _, events) = make(keys: keys)
        XCTAssertNil(controller.handle(id: "m-1", type: "insert.text", payload: insert("hi", method: "keystrokes")))
        waitForReplies(events, count: 1)
        XCTAssertEqual(events.all.first.flatMap(errorCode), "PASTE_FAILED")
    }

    func testBadInputIsRefused() {
        let (controller, _, _, _) = make()
        XCTAssertEqual(
            controller.handle(id: "m-1", type: "insert.text", payload: ["text": .string("x"), "method": .string("shout")])
                .flatMap(errorCode), "INVALID_PAYLOAD")
        XCTAssertEqual(
            controller.handle(id: "m-1", type: "insert.text", payload: ["text": .string("x"), "restoreDelayMs": .int(9_999)])
                .flatMap(errorCode), "INVALID_PAYLOAD")
        XCTAssertEqual(controller.handle(id: "m-1", type: "insert.text", payload: [:]).flatMap(errorCode), "INVALID_PAYLOAD")
    }

    func testCopySetsTheClipboardWithoutAccessibility() {
        let (controller, board, _, _) = make(accessibility: .denied)
        let reply = controller.handle(id: "m-2", type: "insert.copy", payload: ["text": .string("last dictation")])
        XCTAssertEqual(reply?.payload["ok"], .bool(true))
        XCTAssertEqual(board.items, [["public.utf8-plain-text": Data("last dictation".utf8)]])
    }
}

/// The real NSPasteboard code, on a private named pasteboard so the user's clipboard is untouched.
final class SystemPasteboardTests: XCTestCase {
    func testSnapshotAndRestoreKeepEveryItemAndType() {
        let name = NSPasteboard.Name("murmur-test-\(UUID().uuidString)")
        let board = NSPasteboard(name: name)
        defer { board.releaseGlobally() }
        board.clearContents()
        let picture = NSPasteboardItem()
        picture.setData(Data([0x89, 0x50, 0x4E, 0x47, 0x0D]), forType: .png)
        let words = NSPasteboardItem()
        words.setString("before dictation", forType: .string)
        words.setData(Data("{\\rtf1 before}".utf8), forType: .rtf)
        board.writeObjects([picture, words])

        let access = SystemPasteboard(board: board)
        let saved = access.snapshot()
        XCTAssertEqual(saved.items.count, 2)

        let count = access.writeTransientText("dictated text")
        XCTAssertEqual(access.changeCount, count)
        XCTAssertEqual(board.string(forType: .string), "dictated text")
        let types = board.pasteboardItems?.first?.types.map(\.rawValue) ?? []
        XCTAssertTrue(types.contains("org.nspasteboard.TransientType"))
        XCTAssertTrue(types.contains("org.nspasteboard.ConcealedType"))

        access.restore(saved)
        XCTAssertEqual(access.snapshot(), saved)
        XCTAssertEqual(board.pasteboardItems?.first?.data(forType: .png), Data([0x89, 0x50, 0x4E, 0x47, 0x0D]))
        XCTAssertEqual(board.pasteboardItems?.last?.string(forType: .string), "before dictation")
    }

    func testRestoringAnEmptySnapshotClearsThePasteboard() {
        let board = NSPasteboard(name: NSPasteboard.Name("murmur-test-\(UUID().uuidString)"))
        defer { board.releaseGlobally() }
        board.clearContents()
        let access = SystemPasteboard(board: board)
        let saved = access.snapshot()
        _ = access.writeTransientText("x")
        access.restore(saved)
        XCTAssertEqual(board.pasteboardItems?.count ?? 0, 0)
    }
}
