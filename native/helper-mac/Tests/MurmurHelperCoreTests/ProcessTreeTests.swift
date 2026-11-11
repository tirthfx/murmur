import Foundation
import XCTest

@testable import MurmurHelperCore

private struct FakeTable: ProcessTable {
    let front: pid_t?
    let table: [ProcessRow]
    func frontmostPid() -> pid_t? { front }
    func rows() -> [ProcessRow] { table }
}

final class ProcessTreeTests: XCTestCase {
    private let rows = [
        ProcessRow(pid: 1, ppid: 0, name: "launchd"),
        ProcessRow(pid: 100, ppid: 1, name: "Terminal"),
        ProcessRow(pid: 101, ppid: 100, name: "login"),
        ProcessRow(pid: 102, ppid: 101, name: "-zsh"),
        ProcessRow(pid: 103, ppid: 102, name: "Claude"),
        ProcessRow(pid: 104, ppid: 100, name: "login"),
        ProcessRow(pid: 200, ppid: 1, name: "Safari"),
    ]

    func testListsNamesUnderTheAppInFrontOnce() {
        XCTAssertEqual(ProcessController.descendantNames(of: 100, in: rows), ["login", "-zsh", "claude"])
        XCTAssertEqual(ProcessController.descendantNames(of: 200, in: rows), [])
    }

    func testRepliesThroughTheRouterWithNamesOnly() {
        var router = MessageRouter(
            permissions: FakePermissionProvider(),
            processes: ProcessController(table: FakeTable(front: 100, table: rows)),
            uptimeMs: { 1 })
        _ = router.handle(line: line(validAck))
        let replies = router.handle(line: line(#"{"id":"m-1","type":"proc.foreground","payload":{}}"#))
        let names = replies.first?.payload["result"]?.objectValue?["names"]?.arrayValue?.compactMap(\.stringValue)
        XCTAssertEqual(names, ["login", "-zsh", "claude"])
    }

    func testKnowsInterpretersByName() {
        XCTAssertTrue(SystemProcessTable.isInterpreter("python3.12"))
        XCTAssertTrue(SystemProcessTable.isInterpreter("node"))
        XCTAssertFalse(SystemProcessTable.isInterpreter("nodemon"))
    }

    func testNothingInFrontGivesNoNames() {
        let controller = ProcessController(table: FakeTable(front: nil, table: rows))
        XCTAssertEqual(controller.foreground()["names"], .array([]))
    }

    func testTheRealTableSeesThisTestProcess() {
        let rows = SystemProcessTable().rows()
        XCTAssertTrue(rows.contains { $0.pid == getpid() })
    }

    func testFixtureMatchesTheProtocol() throws {
        let data = try Data(contentsOf: fixtureURL("processes.json"))
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let messages = object?["messages"] as? [[String: Any]]
        XCTAssertEqual(messages?.first?["type"] as? String, "proc.foreground")
    }
}
