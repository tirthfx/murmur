import Foundation
import XCTest

@testable import MurmurHelperCore

final class FakeOutput: OutputMuteControl, @unchecked Sendable {
    private let lock = NSLock()
    var muted: Bool?
    var settable = true
    init(muted: Bool?) { self.muted = muted }
    func isMuted() -> Bool? { lock.withLock { muted } }
    func setMuted(_ value: Bool) -> Bool {
        lock.withLock {
            guard settable else { return false }
            muted = value
            return true
        }
    }
}

final class MediaControllerTests: XCTestCase {
    func testMuteReturnsThePreviousState() throws {
        let output = FakeOutput(muted: false)
        let media = MediaController(output: output)
        XCTAssertEqual(try media.mute(["muted": .bool(true)]).get(), ["previousMuted": .bool(false)])
        XCTAssertEqual(output.muted, true)
        XCTAssertEqual(try media.mute(["muted": .bool(false)]).get(), ["previousMuted": .bool(true)])
        XCTAssertEqual(output.muted, false)
    }

    func testAlreadyMutedIsLeftAlone() throws {
        let output = FakeOutput(muted: true)
        output.settable = false
        XCTAssertEqual(try MediaController(output: output).mute(["muted": .bool(true)]).get(), ["previousMuted": .bool(true)])
    }

    func testStatusAndFailures() {
        XCTAssertEqual(MediaController(output: FakeOutput(muted: true)).status()["outputMuted"], .bool(true))
        XCTAssertEqual(MediaController(output: FakeOutput(muted: nil)).status()["outputMuted"], .null)
        guard case .failure(.deviceNotFound) = MediaController(output: FakeOutput(muted: nil)).mute(["muted": .bool(true)]) else {
            return XCTFail("expected no mute switch")
        }
        guard case .failure(.invalidPayload) = MediaController(output: FakeOutput(muted: false)).mute([:]) else {
            return XCTFail("expected invalid payload")
        }
        let stuck = FakeOutput(muted: false)
        stuck.settable = false
        guard case .failure(.engineFailed) = MediaController(output: stuck).mute(["muted": .bool(true)]) else {
            return XCTFail("expected a failure to set")
        }
    }
}
