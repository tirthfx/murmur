import CoreGraphics
import Foundation
import XCTest

@testable import MurmurHelperCore

/// Real CoreGraphics events, built but never posted, go through the tap's handler.
final class TapHandlerMouseTests: XCTestCase {
    private final class Inputs: @unchecked Sendable {
        var seen: [RawKeyInput] = []
    }

    private func event(_ type: CGEventType, button: Int64) throws -> CGEvent {
        let mouseButton: CGMouseButton = type == .leftMouseDown ? .left : .center
        let event = try XCTUnwrap(
            CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: .zero, mouseButton: mouseButton))
        event.setIntegerValueField(.mouseEventButtonNumber, value: button)
        return event
    }

    func testASideButtonReachesTheCallback() throws {
        let inputs = Inputs()
        let handler = TapHandler(onInput: { input, _ in inputs.seen.append(input) }, onStatus: { _ in })
        handler.handle(type: .otherMouseDown, event: try event(.otherMouseDown, button: 3))
        handler.handle(type: .otherMouseUp, event: try event(.otherMouseUp, button: 3))
        XCTAssertEqual(inputs.seen, [.mouseDown(button: 3), .mouseUp(button: 3)])
    }

    func testLeftAndRightButtonsAreDropped() throws {
        let inputs = Inputs()
        let handler = TapHandler(onInput: { input, _ in inputs.seen.append(input) }, onStatus: { _ in })
        handler.handle(type: .otherMouseDown, event: try event(.otherMouseDown, button: 0))
        handler.handle(type: .otherMouseDown, event: try event(.otherMouseDown, button: 1))
        handler.handle(type: .leftMouseDown, event: try event(.leftMouseDown, button: 0))
        XCTAssertEqual(inputs.seen, [])
    }
}
