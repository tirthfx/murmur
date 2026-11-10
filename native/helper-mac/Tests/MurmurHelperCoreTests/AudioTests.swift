import Foundation
import XCTest

@testable import MurmurHelperCore

/// Generated test signals.
enum Signal {
    static func sine(seconds: Double, rate: Double, amplitude: Float, frequency: Double = 440) -> [Float] {
        let count = Int(seconds * rate)
        return (0..<count).map { amplitude * Float(sin(2 * Double.pi * frequency * Double($0) / rate)) }
    }

    static func silence(seconds: Double, rate: Double) -> [Float] {
        [Float](repeating: 0, count: Int(seconds * rate))
    }

    /// Splits into uneven chunks, the way a device delivers buffers.
    static func chunks(_ samples: [Float], sizes: [Int] = [4096, 1024, 3000, 512]) -> [[Float]] {
        var result: [[Float]] = []
        var start = 0
        var index = 0
        while start < samples.count {
            let end = min(samples.count, start + sizes[index % sizes.count])
            result.append(Array(samples[start..<end]))
            start = end
            index += 1
        }
        return result
    }
}

func amplitudeDb(_ db: Double) -> Float { Float(Decibels.toAmplitude(db)) }

/// Runs 16 kHz input through a pipeline and collects everything.
func runPipeline(_ input: [Float], settings: AudioPipelineSettings = AudioPipelineSettings())
    -> (pipeline: AudioPipeline, output: [Float], events: [AudioPipelineEvent])
{
    var pipeline = AudioPipeline(settings: settings)
    var output: [Float] = []
    var events: [AudioPipelineEvent] = []
    for chunk in Signal.chunks(input, sizes: [1600, 333, 2048]) {
        let result = pipeline.process(chunk)
        output += result.output
        events += result.events
    }
    let rest = pipeline.finish()
    return (pipeline, output + rest.output, events + rest.events)
}

final class ResamplerTests: XCTestCase {
    private func resample(_ samples: [Float], rate: Double) throws -> [Float] {
        let resampler = try Resampler(inputRate: rate)
        var output: [Float] = []
        for chunk in Signal.chunks(samples) { output += resampler.process(chunk) }
        return output + resampler.flush()
    }

    func testTenSecondsAtCommonRatesGiveSixteenKilohertzWithinOnePercent() throws {
        for rate in [48_000.0, 44_100.0, 16_000.0, 24_000.0] {
            let output = try resample(Signal.sine(seconds: 10, rate: rate, amplitude: 0.5), rate: rate)
            XCTAssertEqual(Double(output.count), 160_000, accuracy: 1_600, "rate \(rate)")
        }
    }

    func testKeepsTheSignalLevel() throws {
        let output = try resample(Signal.sine(seconds: 1, rate: 48_000, amplitude: 0.5), rate: 48_000)
        let middle = output[2_000..<14_000]
        XCTAssertEqual(Double(middle.map { abs($0) }.max() ?? 0), 0.5, accuracy: 0.02)
    }

    func testRefusesNonsenseRates() {
        XCTAssertThrowsError(try Resampler(inputRate: 0))
        XCTAssertThrowsError(try Resampler(inputRate: 1_000_000))
    }
}

final class AudioPipelineTests: XCTestCase {
    func testLevelEventsArriveAboutTenTimesASecond() {
        let (_, output, events) = runPipeline(Signal.sine(seconds: 10, rate: 16_000, amplitude: 0.1))
        let levels = events.filter { if case .level = $0 { return true } else { return false } }
        XCTAssertEqual(levels.count, 100)
        XCTAssertEqual(output.count, 160_000)
    }

    func testNoLevelEventsWhenTurnedOff() {
        var settings = AudioPipelineSettings()
        settings.levelIntervalMs = 0
        let (_, _, events) = runPipeline(Signal.sine(seconds: 2, rate: 16_000, amplitude: 0.1), settings: settings)
        XCTAssertTrue(events.allSatisfy { if case .level = $0 { return false } else { return true } })
    }

    func testLoudInputPeaksBelowMinusOneDbfs() {
        let (pipeline, output, _) = runPipeline(Signal.sine(seconds: 3, rate: 16_000, amplitude: 1.0))
        let peak = output.map { abs($0) }.max() ?? 0
        XCTAssertLessThan(Decibels.fromAmplitude(Double(peak)), -1.0)
        XCTAssertLessThan(pipeline.peakDb, -1.0)
        // Also after 16-bit conversion.
        let bytes = AudioPipeline.pcm16(output)
        let maxSample = stride(from: 0, to: bytes.count, by: 2).map { offset in
            abs(Int(Int16(littleEndian: bytes[offset..<offset + 2].withUnsafeBytes { $0.loadUnaligned(as: Int16.self) })))
        }.max() ?? 0
        XCTAssertLessThan(Decibels.fromAmplitude(Double(maxSample) / Double(Int16.max)), -1.0)
    }

    func testQuietSpeechIsRaisedTowardsTheTarget() {
        // A tone at -50 dBFS RMS: peak amplitude is RMS times sqrt(2).
        let amplitude = amplitudeDb(-50) * Float(2.0.squareRoot())
        let (pipeline, output, _) = runPipeline(Signal.sine(seconds: 4, rate: 16_000, amplitude: amplitude))
        XCTAssertEqual(pipeline.gainDb, 10, accuracy: 0.6)
        let tail = output.suffix(16_000)
        let rms = (tail.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(tail.count))
        XCTAssertEqual(Decibels.fromMeanSquare(rms), -40, accuracy: 1)
    }

    func testNormalSpeechIsLeftAlone() {
        let (pipeline, _, _) = runPipeline(Signal.sine(seconds: 2, rate: 16_000, amplitude: 0.2))
        XCTAssertEqual(pipeline.gainDb, 0)
    }

    func testBackgroundNoiseIsNotBoosted() {
        let amplitude = amplitudeDb(-70)
        let (pipeline, _, _) = runPipeline(Signal.sine(seconds: 2, rate: 16_000, amplitude: amplitude))
        XCTAssertEqual(pipeline.gainDb, 0)
    }

    func testGainIsCapped() {
        var settings = AudioPipelineSettings()
        settings.speechGateDb = -90
        let amplitude = amplitudeDb(-75)
        let (pipeline, _, _) = runPipeline(Signal.sine(seconds: 8, rate: 16_000, amplitude: amplitude), settings: settings)
        XCTAssertEqual(pipeline.gainDb, 24)
    }

    func testLoudSpeechAfterQuietSpeechStillDoesNotClip() {
        let quiet = Signal.sine(seconds: 3, rate: 16_000, amplitude: amplitudeDb(-50))
        let loud = Signal.sine(seconds: 1, rate: 16_000, amplitude: 0.9)
        let (_, output, _) = runPipeline(quiet + loud)
        XCTAssertLessThan(Decibels.fromAmplitude(Double(output.map { abs($0) }.max() ?? 0)), -1.0)
    }

    func testSilentInputWarnsOnceAtThreeSeconds() {
        let (pipeline, _, events) = runPipeline(Signal.silence(seconds: 6, rate: 16_000))
        let silent = events.compactMap { event -> Int? in
            if case .silent(let elapsed) = event { return elapsed } else { return nil }
        }
        XCTAssertEqual(silent, [3_000])
        XCTAssertFalse(pipeline.heardInput)
        // The warning comes with the 30th level event, not later.
        let index = events.firstIndex(of: .silent(elapsedMs: 3_000))!
        XCTAssertEqual(events[..<index].filter { if case .level = $0 { return true } else { return false } }.count, 30)
    }

    func testSpeechInTheFirstThreeSecondsMeansNoWarning() {
        let input = Signal.silence(seconds: 2, rate: 16_000) + Signal.sine(seconds: 0.5, rate: 16_000, amplitude: 0.1)
            + Signal.silence(seconds: 4, rate: 16_000)
        let (pipeline, _, events) = runPipeline(input)
        XCTAssertFalse(events.contains(.silent(elapsedMs: 3_000)))
        XCTAssertTrue(pipeline.heardInput)
    }

    func testStatisticsDescribeTheOutput() {
        let (pipeline, _, _) = runPipeline(Signal.sine(seconds: 1, rate: 16_000, amplitude: 0.5))
        XCTAssertEqual(pipeline.durationMs, 1_000)
        XCTAssertEqual(pipeline.peakDb, Decibels.fromAmplitude(0.5), accuracy: 0.1)
        XCTAssertEqual(pipeline.meanDb, Decibels.fromAmplitude(0.5 / 2.0.squareRoot()), accuracy: 0.2)
    }
}

/// Plays generated audio instead of a microphone. `feed` calls the controller synchronously.
final class FakeAudioSource: AudioInputSource, @unchecked Sendable {
    private let lock = NSLock()
    private var onSamples: (@Sendable ([Float], Double) -> Void)?
    /// The last handler given to `start`, kept after `stop` so a test can call it late.
    private(set) var lastHandler: (@Sendable ([Float], Double) -> Void)?
    var startError: AudioSourceError?
    private(set) var starts = 0
    private(set) var stops = 0

    private(set) var startedWith: [String?] = []
    var devices: [AudioDevice] = [
        AudioDevice(id: "BuiltIn", name: "MacBook Pro Microphone", isDefault: true, transport: "builtin", sampleRate: 48_000),
        AudioDevice(id: "USB-1", name: "Desk Mic", isDefault: false, transport: "usb", sampleRate: 44_100),
    ]

    func listDevices() -> [AudioDevice] { lock.withLock { devices } }

    func start(deviceUID: String?, onSamples: @escaping @Sendable ([Float], Double) -> Void) throws -> String {
        try lock.withLock {
            starts += 1
            startedWith.append(deviceUID)
            if let startError { throw startError }
            if let deviceUID {
                guard let device = devices.first(where: { $0.id == deviceUID }) else { throw AudioSourceError.deviceNotFound }
                self.onSamples = onSamples
                lastHandler = onSamples
                return device.name
            }
            self.onSamples = onSamples
            lastHandler = onSamples
            return "Test Microphone"
        }
    }

    func stop() {
        lock.withLock {
            stops += 1
            onSamples = nil
        }
    }

    func feed(_ samples: [Float], rate: Double) {
        let handler = lock.withLock { onSamples }
        for chunk in Signal.chunks(samples) { handler?(chunk, rate) }
    }
}

final class AudioCaptureControllerTests: XCTestCase {
    private var directory: URL!

    override func setUp() {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("murmur-audio-tests-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func make(microphone: PermissionStatus = .granted)
        -> (AudioCaptureController, FakeAudioSource, EmittedEvents, FakePermissionProvider)
    {
        let source = FakeAudioSource()
        let events = EmittedEvents()
        let permissions = FakePermissionProvider([.microphone: microphone])
        let controller = AudioCaptureController(
            source: source, permissions: permissions, directory: directory, emit: { events.append($0) },
            now: { 1_794_316_800_000 })
        return (controller, source, events, permissions)
    }

    private func start(_ id: String = "s-1") -> [String: JSONValue] {
        ["sessionId": .string(id), "emitLevels": .bool(true), "levelIntervalMs": .int(100)]
    }

    func testTenSecondCaptureWritesTheExpectedSamples() throws {
        let (controller, source, events, _) = make()
        let started = try controller.start(start()).get()
        XCTAssertEqual(started["sampleRate"], .int(16_000))
        XCTAssertEqual(started["channels"], .int(1))
        XCTAssertEqual(started["deviceName"], .string("Test Microphone"))

        source.feed(Signal.sine(seconds: 10, rate: 48_000, amplitude: 0.2), rate: 48_000)
        let stopped = try controller.stop(["sessionId": .string("s-1")]).get()

        let samples = try XCTUnwrap(stopped["samples"]?.intValue)
        XCTAssertEqual(Double(samples), 160_000, accuracy: 1_600)
        XCTAssertEqual(Double(stopped["durationMs"]?.intValue ?? 0), 10_000, accuracy: 100)
        XCTAssertEqual(stopped["silent"], .bool(false))
        let file = try XCTUnwrap(stopped["audioFile"]?.objectValue)
        XCTAssertEqual(file["codec"], .string("pcm_s16le"))
        let path = try XCTUnwrap(file["path"]?.stringValue)
        XCTAssertEqual(path, directory.appendingPathComponent("s-1.pcm").path)
        let size = try FileManager.default.attributesOfItem(atPath: path)[.size] as? Int
        XCTAssertEqual(size, samples * 2)
        XCTAssertEqual(file["bytes"], .int(samples * 2))

        let levels = events.all.filter { $0.type == "audio.level" }
        XCTAssertEqual(Double(levels.count), 100, accuracy: 2)
        XCTAssertEqual(levels.first?.payload["sessionId"], .string("s-1"))
        XCTAssertEqual(levels.first?.payload["source"], .string("mic"))
        XCTAssertEqual(source.stops, 1)
        XCTAssertFalse(controller.isCapturing)
    }

    func testSilentMicrophoneWarnsWithTheDeviceName() throws {
        let (controller, source, events, _) = make()
        _ = try controller.start(start()).get()
        source.feed(Signal.silence(seconds: 4, rate: 44_100), rate: 44_100)
        let silent = events.all.filter { $0.type == "audio.silent" }
        XCTAssertEqual(silent.count, 1)
        XCTAssertEqual(silent.first?.payload["elapsedMs"], .int(3_000))
        XCTAssertEqual(silent.first?.payload["deviceName"], .string("Test Microphone"))
        let stopped = try controller.stop(["sessionId": .string("s-1")]).get()
        XCTAssertEqual(stopped["silent"], .bool(true))
    }

    func testMissingPermissionNeverStartsTheMicrophone() {
        for status in [PermissionStatus.denied, .notDetermined, .unknown] {
            let (controller, source, _, permissions) = make(microphone: status)
            XCTAssertEqual(
                controller.start(start()),
                .failure(.permissionDenied("microphone: Microphone access is not granted")))
            XCTAssertEqual(source.starts, 0)
            XCTAssertEqual(permissions.requests, [])
        }
    }

    func testSecondStartIsBusy() throws {
        let (controller, _, _, _) = make()
        _ = try controller.start(start("a")).get()
        guard case .failure(.busy) = controller.start(start("b")) else { return XCTFail("expected BUSY") }
    }

    func testStopNeedsTheRunningSessionId() throws {
        let (controller, _, _, _) = make()
        guard case .failure(.notFound) = controller.stop(["sessionId": .string("nope")]) else {
            return XCTFail("expected NOT_FOUND with nothing running")
        }
        _ = try controller.start(start("a")).get()
        guard case .failure(.notFound) = controller.stop(["sessionId": .string("b")]) else {
            return XCTFail("expected NOT_FOUND for another id")
        }
        XCTAssertTrue(controller.isCapturing)
    }

    func testAChosenDeviceIsUsedAndAMissingOneIsReported() throws {
        let (controller, source, _, _) = make()
        let started = try controller.start(["sessionId": .string("a"), "deviceId": .string("USB-1")]).get()
        XCTAssertEqual(started["deviceName"], .string("Desk Mic"))
        _ = try controller.cancel(["sessionId": .string("a")]).get()
        XCTAssertEqual(
            controller.start(["sessionId": .string("b"), "deviceId": .string("Gone")]),
            .failure(.deviceNotFound("Selected input device is not connected")))
        XCTAssertEqual(source.startedWith, ["USB-1", "Gone"])
        XCTAssertFalse(controller.isCapturing)
    }

    func testDevicesAreListed() {
        let (controller, _, _, _) = make()
        guard case .array(let devices)? = controller.devices()["devices"] else { return XCTFail("no devices") }
        XCTAssertEqual(devices.count, 2)
        XCTAssertEqual(
            devices.last,
            .object([
                "id": .string("USB-1"), "name": .string("Desk Mic"), "isDefault": .bool(false),
                "transport": .string("usb"), "sampleRate": .int(44_100),
            ]))
    }

    func testUnsafeSessionIdsAndOtherDevicesAreRefused() {
        let (controller, source, _, _) = make()
        for id in ["", "../escape", "a/b", String(repeating: "x", count: 65), "spaces here"] {
            guard case .failure(.invalidPayload) = controller.start(["sessionId": .string(id)]) else {
                return XCTFail("accepted \(id)")
            }
        }
        guard case .failure(.invalidPayload) = controller.start(["sessionId": .string("a"), "deviceId": .int(3)])
        else { return XCTFail("accepted a non-string device id") }
        guard case .failure(.invalidPayload) = controller.start(["sessionId": .string("a"), "levelIntervalMs": .int(1)])
        else { return XCTFail("accepted a 1 ms level interval") }
        XCTAssertEqual(source.starts, 0)
    }

    func testCancelDeletesTheFile() throws {
        let (controller, source, _, _) = make()
        _ = try controller.start(start()).get()
        source.feed(Signal.sine(seconds: 1, rate: 48_000, amplitude: 0.2), rate: 48_000)
        XCTAssertEqual(try controller.cancel(["sessionId": .string("s-1")]).get(), ["discarded": .bool(true)])
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("s-1.pcm").path))
        XCTAssertFalse(controller.isCapturing)
    }

    func testStopWithNoAudioReturnsNoFile() throws {
        let (controller, _, _, _) = make()
        _ = try controller.start(start()).get()
        let stopped = try controller.stop(["sessionId": .string("s-1")]).get()
        XCTAssertEqual(stopped["audioFile"], .null)
        XCTAssertEqual(stopped["durationMs"], .int(0))
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("s-1.pcm").path))
    }

    func testNoInputDeviceLeavesNothingBehind() {
        let (controller, source, _, _) = make()
        source.startError = .noInputDevice
        XCTAssertEqual(controller.start(start()), .failure(.deviceNotFound("No input device is connected")))
        XCTAssertFalse(controller.isCapturing)
        let files = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        XCTAssertEqual(files, [])
    }

    func testSamplesAfterStopAreIgnored() throws {
        let (controller, source, events, _) = make()
        _ = try controller.start(start()).get()
        let late = source.lastHandler
        _ = try controller.stop(["sessionId": .string("s-1")]).get()
        events.clear()
        late?(Signal.sine(seconds: 1, rate: 16_000, amplitude: 0.2), 16_000)
        XCTAssertEqual(events.all, [])
    }

    func testShutdownDiscardsTheRunningSession() throws {
        let (controller, source, _, _) = make()
        _ = try controller.start(start()).get()
        source.feed(Signal.sine(seconds: 1, rate: 48_000, amplitude: 0.2), rate: 48_000)
        controller.shutdown()
        XCTAssertFalse(controller.isCapturing)
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("s-1.pcm").path))
    }

    func testOldTemporaryFilesArePrunedOnStart() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let old = directory.appendingPathComponent("old.pcm")
        let fresh = directory.appendingPathComponent("fresh.pcm")
        FileManager.default.createFile(atPath: old.path, contents: Data([1, 2]))
        FileManager.default.createFile(atPath: fresh.path, contents: Data([1, 2]))
        try FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(-2 * AudioCaptureController.tempFileMaxAge)],
            ofItemAtPath: old.path)
        let (controller, _, _, _) = make()
        _ = try controller.start(start()).get()
        XCTAssertFalse(FileManager.default.fileExists(atPath: old.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: fresh.path))
    }
}

final class AudioRouterTests: XCTestCase {
    func testAudioRequestsAreUnsupportedWithoutAController() {
        var router = handshaken()
        let reply = router.handle(line: line(#"{"id":"m-000002","type":"audio.start","payload":{"sessionId":"a"}}"#))
        XCTAssertEqual(reply.first.flatMap(errorCode), "UNSUPPORTED_REQUEST")
    }

    func testFixtureRequestsGetMatchingReplies() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("murmur-audio-router-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let source = FakeAudioSource()
        let audio = AudioCaptureController(
            source: source, permissions: FakePermissionProvider([.microphone: .granted]), directory: directory,
            emit: { _ in }, now: { 1_794_316_800_142 })
        var router = MessageRouter(permissions: FakePermissionProvider(), audio: audio, uptimeMs: { 0 })
        _ = router.handle(line: line(validAck))

        let start = router.handle(
            line: line(
                #"{"id":"m-000021","type":"audio.start","payload":{"sessionId":"3f0c2e7a-7d2b-4a55-9d0e-7a1d2c4b9e10","emitLevels":true,"levelIntervalMs":100}}"#
            ))
        XCTAssertEqual(start.first?.payload["ok"], .bool(true))
        XCTAssertEqual(start.first?.payload["result"]?.objectValue?["startedAt"], .int(1_794_316_800_142))

        let busy = router.handle(
            line: line(#"{"id":"m-000022","type":"audio.start","payload":{"sessionId":"other"}}"#))
        XCTAssertEqual(busy.first.flatMap(errorCode), "BUSY")
        XCTAssertEqual(busy.first?.payload["error"]?.objectValue?["retryable"], .bool(true))

        source.feed(Signal.sine(seconds: 1, rate: 48_000, amplitude: 0.2), rate: 48_000)
        let stop = router.handle(
            line: line(#"{"id":"m-000033","type":"audio.stop","payload":{"sessionId":"3f0c2e7a-7d2b-4a55-9d0e-7a1d2c4b9e10"}}"#))
        XCTAssertEqual(stop.first?.payload["requestType"], .string("audio.stop"))
        XCTAssertEqual(stop.first?.payload["ok"], .bool(true))

        let again = router.handle(
            line: line(#"{"id":"m-000034","type":"audio.cancel","payload":{"sessionId":"3f0c2e7a-7d2b-4a55-9d0e-7a1d2c4b9e10"}}"#))
        XCTAssertEqual(again.first.flatMap(errorCode), "NOT_FOUND")
    }
}
