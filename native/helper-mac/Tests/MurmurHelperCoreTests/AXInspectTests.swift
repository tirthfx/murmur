import Foundation
import XCTest

@testable import MurmurHelperCore

private final class FakeElement: InspectableElement {
    let role: String?
    let subrole: String?
    let title: String?
    let isEditable: Bool
    let text: String?
    let selectedRange: (location: Int, length: Int)?
    var kids: [FakeElement]
    private(set) var valueReads = 0

    init(
        role: String, subrole: String? = nil, title: String? = nil, editable: Bool = false, value: String? = nil,
        range: (Int, Int)? = nil, children: [FakeElement] = []
    ) {
        self.role = role
        self.subrole = subrole
        self.title = title
        isEditable = editable
        text = value
        selectedRange = range.map { (location: $0.0, length: $0.1) }
        kids = children
    }

    func value() -> String? {
        valueReads += 1
        return text
    }

    func children() -> [any InspectableElement] { kids }
}

private struct FakeSource: InspectSource, @unchecked Sendable {
    let window: FakeElement?
    func target() -> (app: FrontAppInfo, window: any InspectableElement)? {
        window.map { (FrontAppInfo(bundleId: "com.apple.TextEdit", name: "TextEdit", pid: 5), $0) }
    }
}

final class AXInspectTests: XCTestCase {
    func testWalksInOrderWithValuesHiddenByDefault() {
        let field = FakeElement(role: "AXTextArea", editable: true, value: "hello", range: (2, 3))
        let window = FakeElement(role: "AXWindow", title: "Doc", children: [field, FakeElement(role: "AXButton")])
        let (nodes, truncated) = AXInspector.walk(root: window, showValues: false)
        XCTAssertFalse(truncated)
        XCTAssertEqual(nodes.map(\.role), ["AXWindow", "AXTextArea", "AXButton"])
        XCTAssertEqual(nodes[1].depth, 1)
        XCTAssertEqual(nodes[1].selectedRange, [2, 3])
        XCTAssertNil(nodes[1].value)
        XCTAssertEqual(field.valueReads, 0)
        XCTAssertEqual(AXInspector.walk(root: window, showValues: true).nodes[1].value, "hello")
    }

    func testSecureFieldsNeverGiveAValue() {
        let secret = FakeElement(role: "AXTextField", subrole: "AXSecureTextField", value: "pw", range: (0, 2))
        let window = FakeElement(role: "AXWindow", children: [secret])
        let nodes = AXInspector.walk(root: window, showValues: true).nodes
        XCTAssertTrue(nodes[1].secure)
        XCTAssertNil(nodes[1].value)
        XCTAssertNil(nodes[1].selectedRange)
        XCTAssertEqual(secret.valueReads, 0)
    }

    func testStopsAtFiveHundredNodesAndAtDepthSix() {
        let wide = FakeElement(role: "AXWindow", children: (0..<600).map { _ in FakeElement(role: "AXStaticText") })
        let (nodes, truncated) = AXInspector.walk(root: wide, showValues: false)
        XCTAssertEqual(nodes.count, 500)
        XCTAssertTrue(truncated)

        var deep = FakeElement(role: "AXGroup")
        for _ in 0..<10 { deep = FakeElement(role: "AXGroup", children: [deep]) }
        let result = AXInspector.walk(root: deep, showValues: false)
        XCTAssertEqual(result.nodes.map(\.depth).max(), 6)
        XCTAssertTrue(result.truncated)
    }

    func testControllerNeedsAccessibilityAndReturnsRows() {
        let window = FakeElement(role: "AXWindow")
        let denied = AXInspectController(
            source: FakeSource(window: window), permissions: FakePermissionProvider([.accessibility: .denied]))
        XCTAssertEqual(
            denied.handle(id: "1", payload: ["showValues": .bool(false)]).payload["ok"], .bool(false))
        let granted = AXInspectController(
            source: FakeSource(window: window), permissions: FakePermissionProvider([.accessibility: .granted]))
        let result = granted.handle(id: "2", payload: ["showValues": .bool(false)]).payload["result"]?.objectValue
        XCTAssertEqual(result?["app"], .string("TextEdit"))
        XCTAssertEqual(result?["nodes"]?.arrayValue?.count, 1)
        XCTAssertEqual(
            granted.handle(id: "3", payload: [:]).payload["ok"], .bool(false))
    }
}
