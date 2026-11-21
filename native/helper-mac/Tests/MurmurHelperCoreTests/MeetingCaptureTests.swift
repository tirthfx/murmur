import AVFoundation
import CryptoKit
import Foundation
import XCTest

@testable import MurmurHelperCore

/// A channel the test feeds by hand.
final class FakeChannelSource: MeetingChannelSource, @unchecked Sendable {
    private let lock = NSLock()
    private var handler: (@Sendable ([Float], Double) -> Void)?
    private var issueHandler: (@Sendable (String) -> Void)?
    var failStart = false
    private(set) var starts: [String?] = []
    private(set) var stops = 0

    func start(
        deviceUID: String?, onSamples: @escaping @Sendable ([Float], Double) -> Void,
        onIssue: @escaping @Sendable (String) -> Void
    ) throws -> String {
        if failStart { throw AudioSourceError.engine("no") }
        lock.withLock {
            starts.append(deviceUID)
            handler = onSamples
            issueHandler = onIssue
        }
        return "Fake"
    }

    func stop() {
        lock.withLock {
            stops += 1
            handler = nil
        }
    }

    func feed(seconds: Double, value: Float = 0.1, rate: Double = 16_000) {
        let samples = [Float](repeating: value, count: Int(seconds * rate))
        lock.withLock { handler }?(samples, rate)
    }

    func report(_ code: String) { lock.withLock { issueHandler }?(code) }
}

/// Writes raw floats, so tests can count samples.
struct RawEncoder: ChunkEncoder {
    var fileExtension: String { "raw" }
    func open(url: URL) throws -> any ChunkFile { try RawFile(url: url) }
}

final class RawFile: ChunkFile {
    let handle: FileHandle
    init(url: URL) throws {
        FileManager.default.createFile(atPath: url.path, contents: nil)
        handle = try FileHandle(forWritingTo: url)
    }
    func append(_ samples: [Float]) throws {
        try handle.write(contentsOf: samples.withUnsafeBufferPointer { Data(buffer: $0) })
    }
    func close() { try? handle.close() }
}

final class ManualClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 1_000_000
    var ms: Int { lock.withLock { value } }
    func advance(seconds: Double) { lock.withLock { value += Int(seconds * 1000) } }
}

final class MeetingCaptureTests: XCTestCase {
    var folder: URL!

    override func setUp() {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("meeting-\(UUID().uuidString)")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: folder)
    }

    func make(
        microphone: PermissionStatus = .granted, screen: PermissionStatus = .granted
    ) -> (MeetingCaptureController, FakeChannelSource, FakeChannelSource, EmittedEvents, ManualClock) {
        let mic = FakeChannelSource()
        let system = FakeChannelSource()
        let events = EmittedEvents()
        let clock = ManualClock()
        let controller = MeetingCaptureController(
            mic: mic, system: system,
            permissions: FakePermissionProvider([.microphone: microphone, .screenRecording: screen]),
            encoder: RawEncoder(), emit: { events.append($0) }, now: { clock.ms }, tickInterval: nil)
        return (controller, mic, system, events, clock)
    }

    func startPayload(_ extra: [String: JSONValue] = [:]) -> [String: JSONValue] {
        var payload: [String: JSONValue] = [
            "meetingId": .string("m-1"), "folder": .string(folder.path), "chunkSeconds": .int(2),
        ]
        payload.merge(extra) { $1 }
        return payload
    }

    func chunks(_ events: EmittedEvents, _ channel: String) -> [[String: JSONValue]] {
        events.all.filter { $0.type == "capture.chunk" && $0.payload["channel"]?.stringValue == channel }
            .map(\.payload)
    }

    func testRecordsBothChannelsInChunksWithHashes() throws {
        let (controller, mic, system, events, clock) = make()
        guard case .success(let started) = controller.start(startPayload()) else { return XCTFail("start") }
        XCTAssertEqual(started["warnings"], .array([]))
        for _ in 0..<5 {
            clock.advance(seconds: 1)
            mic.feed(seconds: 1)
            system.feed(seconds: 1, rate: 48_000)
        }
        guard case .success(let stopped) = controller.stop(["meetingId": .string("m-1")]) else {
            return XCTFail("stop")
        }
        XCTAssertEqual(stopped["durationMs"], .int(5000))
        for channel in ["mic", "system"] {
            let list = chunks(events, channel)
            XCTAssertEqual(list.map { $0["seq"] }, [.int(1), .int(2), .int(3)], channel)
            XCTAssertEqual(list.map { $0["startMs"] }, [.int(0), .int(2000), .int(4000)], channel)
            let total = list.compactMap { $0["durationMs"]?.intValue }.reduce(0, +)
            XCTAssertEqual(Double(total), 5000, accuracy: 1000, channel)
            for chunk in list {
                let path = try XCTUnwrap(chunk["path"]?.stringValue)
                XCTAssertTrue(path.hasSuffix(String(format: "%@-%06d.raw", channel, chunk["seq"]!.intValue!)))
                let data = try Data(contentsOf: URL(fileURLWithPath: path))
                let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                XCTAssertEqual(chunk["sha256"]?.stringValue, hash)
                XCTAssertEqual(chunk["bytes"]?.intValue, data.count)
            }
        }
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: folder.path).filter { $0.contains("partial") }
        XCTAssertEqual(leftovers, [])
        XCTAssertFalse(events.all.filter { $0.type == "capture.level" }.isEmpty)
    }

    func testFillsAChannelThatFallsBehindTheClock() throws {
        let (controller, mic, _, events, clock) = make()
        _ = controller.start(startPayload())
        clock.advance(seconds: 1)
        mic.feed(seconds: 1)
        // The system channel sends nothing; after 3 s the tick fills it with silence.
        clock.advance(seconds: 2)
        mic.feed(seconds: 2)
        controller.tick()
        _ = controller.stop(["meetingId": .string("m-1")])
        for channel in ["mic", "system"] {
            let total = chunks(events, channel).compactMap { $0["durationMs"]?.intValue }.reduce(0, +)
            XCTAssertEqual(Double(total), 3000, accuracy: 300, channel)
        }
    }

    func testMicOnlyWithoutScreenRecording() {
        let (controller, mic, system, events, clock) = make(screen: .unknown)
        guard case .success(let started) = controller.start(startPayload()) else { return XCTFail("start") }
        XCTAssertEqual(started["warnings"], .array([.string("system_permission")]))
        XCTAssertEqual(system.starts.count, 0)
        clock.advance(seconds: 1)
        mic.feed(seconds: 1)
        _ = controller.stop(["meetingId": .string("m-1")])
        XCTAssertEqual(chunks(events, "mic").count, 1)
        XCTAssertEqual(chunks(events, "system").count, 0)
    }

    func testSystemFailureKeepsTheMic() {
        let (controller, _, system, _, _) = make()
        system.failStart = true
        guard case .success(let started) = controller.start(startPayload()) else { return XCTFail("start") }
        XCTAssertEqual(started["warnings"], .array([.string("system_unavailable")]))
        XCTAssertTrue(controller.isCapturing)
    }

    func testIssuesAreReportedAndRecordingGoesOn() {
        let (controller, mic, system, events, _) = make()
        _ = controller.start(startPayload())
        system.report("sck_stream_stopped")
        mic.report("device_lost")
        let errors = events.all.filter { $0.type == "capture.error" }.map { $0.payload["code"]?.stringValue }
        XCTAssertEqual(errors, ["sck_stream_stopped", "device_lost"])
        XCTAssertTrue(controller.isCapturing)
    }

    func testChecksPayloadPermissionAndBusy() {
        let (controller, _, _, _, _) = make(microphone: .denied)
        guard case .failure(.permissionDenied) = controller.start(startPayload()) else { return XCTFail("mic") }
        let (other, mic, _, _, _) = make()
        guard case .failure(.invalidPayload) = other.start(startPayload(["folder": .string("relative/x")])) else {
            return XCTFail("folder")
        }
        guard case .failure(.invalidPayload) = other.start(startPayload(["folder": .string("/a/../b")])) else {
            return XCTFail("dots")
        }
        guard case .failure(.invalidPayload) = other.start(startPayload(["meetingId": .string("../x")])) else {
            return XCTFail("id")
        }
        guard case .success = other.start(startPayload(["micDeviceId": .string("usb-1")])) else {
            return XCTFail("start")
        }
        XCTAssertEqual(mic.starts, ["usb-1"])
        guard case .failure(.busy) = other.start(startPayload()) else { return XCTFail("busy") }
        guard case .failure(.notFound) = other.stop(["meetingId": .string("m-2")]) else { return XCTFail("stop") }
    }

    func testRouterAnswersCaptureRequests() {
        let (controller, _, _, _, _) = make()
        var router = MessageRouter(permissions: FakePermissionProvider(), meeting: controller, uptimeMs: { 0 })
        _ = router.handle(line: line(validAck))
        let payload = #"{"meetingId":"m-1","folder":"\#(folder.path)","channels":["mic"]}"#
        let reply = router.handle(line: line(#"{"id":"1","type":"capture.start","payload":\#(payload)}"#))
        XCTAssertEqual(reply.first?.payload["ok"], .bool(true))
        let stop = router.handle(line: line(#"{"id":"2","type":"capture.stop","payload":{"meetingId":"m-1"}}"#))
        XCTAssertEqual(stop.first?.payload["ok"], .bool(true))
    }

    func testAACChunkFileIsReadable() throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appendingPathComponent("mic-000001.m4a")
        let file = try AACChunkEncoder().open(url: url)
        let tone = (0..<16_000).map { Float(sin(Double($0) * 0.1) * 0.3) }
        try file.append(tone)
        file.close()
        let read = try AVAudioFile(forReading: url)
        XCTAssertEqual(read.fileFormat.sampleRate, 16_000)
        XCTAssertEqual(Double(read.length), 16_000, accuracy: 2_048)
    }

    func testLiveAudioIsTheChunkBeingWritten() {
        let (controller, mic, _, _, clock) = make()
        _ = controller.start(startPayload())
        XCTAssertNil(controller.liveAudio(meetingId: "m-1", channel: "other"))
        clock.advance(seconds: 3)
        mic.feed(seconds: 3)
        // Chunks are 2 s: the second one holds 1 s and starts at 2 s.
        let live = controller.liveAudio(meetingId: "m-1", channel: "mic")
        XCTAssertEqual(live?.seq, 2)
        XCTAssertEqual(live?.startMs, 2000)
        XCTAssertEqual(live?.samples.count, 16_000)
        clock.advance(seconds: 1)
        mic.feed(seconds: 1)
        // Exactly at a chunk boundary: nothing open yet; the next is number 3 at 4 s.
        let between = controller.liveAudio(meetingId: "m-1", channel: "mic")
        XCTAssertEqual(between?.seq, 3)
        XCTAssertEqual(between?.startMs, 4000)
        XCTAssertEqual(between?.samples.count, 0)
    }

    func testRouterDecodesTheLiveChunk() async throws {
        let (controller, mic, _, _, clock) = make()
        let recognizer = FakeRecognizer()
        let replies = EmittedEvents()
        let speech = TranscriptionController(recognizer: recognizer, reply: { replies.append($0) })
        var router = MessageRouter(
            permissions: FakePermissionProvider(), speech: speech, meeting: controller, uptimeMs: { 0 })
        _ = router.handle(line: line(validAck))
        _ = router.handle(
            line: line(#"{"id":"l","type":"transcribe.load","payload":{"model":"m","modelDir":"/a","tokenizerDir":"/b"}}"#))
        waitForReplies(replies, count: 1)
        replies.clear()
        _ = controller.start(startPayload(["chunkSeconds": .int(30)]))
        clock.advance(seconds: 0.5)
        mic.feed(seconds: 0.5, value: 0.2)
        // Under a second: answered at once with no text, without decoding.
        let short = router.handle(
            line: line(#"{"id":"1","type":"transcribe.live","payload":{"meetingId":"m-1","channel":"mic"}}"#))
        XCTAssertEqual(short.first?.payload["result"]?.objectValue?["seq"], .int(1))
        XCTAssertEqual(short.first?.payload["result"]?.objectValue?["segments"], .array([]))
        clock.advance(seconds: 2)
        mic.feed(seconds: 2, value: 0.2)
        let later = router.handle(
            line: line(#"{"id":"2","type":"transcribe.live","payload":{"meetingId":"m-1","channel":"mic"}}"#))
        XCTAssertEqual(later, [])
        waitForReplies(replies, count: 1)
        let result = try XCTUnwrap(replies.all.first?.payload["result"]?.objectValue)
        XCTAssertEqual(result["text"], .string("Hello there."))
        XCTAssertEqual(result["startMs"], .int(0))
        XCTAssertEqual(result["channel"], .string("mic"))
        let decodes = await recognizer.decodes
        XCTAssertEqual(decodes.first?.count, 40_000)
    }
}
