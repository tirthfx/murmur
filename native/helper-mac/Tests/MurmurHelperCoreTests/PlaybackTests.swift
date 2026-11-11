import Foundation
import XCTest

@testable import MurmurHelperCore

private final class FakeNowPlaying: NowPlayingControl, @unchecked Sendable {
    private let lock = NSLock()
    private var state: Bool?
    private(set) var commands: [String] = []
    init(_ state: Bool?) { self.state = state }
    func isPlaying() -> Bool? { lock.withLock { state } }
    func pause() -> Bool {
        lock.withLock {
            commands.append("pause")
            state = false
        }
        return true
    }
    func play() -> Bool {
        lock.withLock {
            commands.append("play")
            state = true
        }
        return true
    }
}

final class PlaybackTests: XCTestCase {
    func testPausesOnlyWhatIsPlaying() throws {
        let playing = FakeNowPlaying(true)
        let controller = PlaybackController(control: playing)
        XCTAssertEqual(try controller.handle(type: "media.playback").get(), ["available": .bool(true), "playing": .bool(true)])
        XCTAssertEqual(try controller.handle(type: "media.pause").get(), ["paused": .bool(true)])
        XCTAssertEqual(try controller.handle(type: "media.resume").get(), ["resumed": .bool(true)])
        XCTAssertEqual(playing.commands, ["pause", "play"])

        let quiet = FakeNowPlaying(false)
        XCTAssertEqual(try PlaybackController(control: quiet).handle(type: "media.pause").get(), ["paused": .bool(false)])
        XCTAssertEqual(quiet.commands, [])
    }

    func testReportsWhenTheSystemWillNotSay() {
        let controller = PlaybackController(control: FakeNowPlaying(nil))
        XCTAssertEqual(try? controller.handle(type: "media.playback").get(), ["available": .bool(false), "playing": .null])
        guard case .failure(let failure) = controller.handle(type: "media.pause") else { return XCTFail() }
        XCTAssertEqual(failure.code, .deviceNotFound)
    }
}
