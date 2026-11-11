import AVFoundation
import Foundation
import XCTest

@testable import MurmurHelperCore

final class FileAudioSourceTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("murmur-fixture-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    /// Writes a stereo WAV: a sine on the left channel, silence on the right.
    private func writeClip(seconds: Double, rate: Double) throws -> URL {
        let url = directory.appendingPathComponent("clip.wav")
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2))
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        let samples = Signal.sine(seconds: seconds, rate: rate, amplitude: 0.5)
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)))
        buffer.frameLength = AVAudioFrameCount(samples.count)
        let channels = try XCTUnwrap(buffer.floatChannelData)
        for (index, sample) in samples.enumerated() {
            channels[0][index] = sample
            channels[1][index] = 0
        }
        try file.write(from: buffer)
        return url
    }

    func testDeliversTheWholeClipAsMonoAtItsOwnRate() throws {
        let url = try writeClip(seconds: 1, rate: 44_100)
        let source = FileAudioSource(url: url, realTime: false)
        let collected = Collected()
        let name = try source.start(deviceUID: nil) { samples, rate in collected.add(samples, rate) }
        source.waitUntilFinished()
        source.stop()
        XCTAssertEqual(name, "Fixture clip (clip.wav)")
        XCTAssertEqual(collected.rates, [44_100])
        XCTAssertEqual(collected.samples.count, 44_100)
        // Two channels averaged: half of the 0.5 sine.
        let peak = collected.samples.map { abs($0) }.max() ?? 0
        XCTAssertEqual(peak, 0.25, accuracy: 0.01)
    }

    func testRealTimeKeepsSendingSilenceUntilStoppedAndNothingAfter() throws {
        let url = try writeClip(seconds: 0.05, rate: 16_000)
        let source = FileAudioSource(url: url)
        let collected = Collected()
        _ = try source.start(deviceUID: nil) { samples, rate in collected.add(samples, rate) }
        Thread.sleep(forTimeInterval: 0.6)
        source.stop()
        let count = collected.samples.count
        XCTAssertGreaterThan(count, 800 + 4096, "silence follows the clip")
        Thread.sleep(forTimeInterval: 0.3)
        XCTAssertEqual(collected.samples.count, count, "nothing arrives after stop")
    }

    func testAMissingFileIsAnEngineError() {
        let source = FileAudioSource(url: directory.appendingPathComponent("nope.wav"))
        XCTAssertThrowsError(try source.start(deviceUID: nil) { _, _ in }) { error in
            guard case AudioSourceError.engine = error else { return XCTFail("\(error)") }
        }
    }

    func testListsOneFixtureDevice() {
        let devices = FileAudioSource(url: directory).listDevices()
        XCTAssertEqual(devices.map(\.id), [FileAudioSource.deviceId])
    }

    func testFixturePermissionsGrantOnlyTheMicrophone() {
        let base = FakePermissionProvider()
        let provider = FixturePermissionProvider(base: base)
        XCTAssertEqual(provider.status(of: .microphone), .granted)
        XCTAssertEqual(provider.status(of: .accessibility), base.status(of: .accessibility))
    }
}

private final class Collected: @unchecked Sendable {
    private let lock = NSLock()
    private var all: [Float] = []
    private var seen: Set<Double> = []

    func add(_ samples: [Float], _ rate: Double) {
        lock.lock()
        all += samples
        seen.insert(rate)
        lock.unlock()
    }

    var samples: [Float] {
        lock.lock()
        defer { lock.unlock() }
        return all
    }

    var rates: [Double] {
        lock.lock()
        defer { lock.unlock() }
        return Array(seen)
    }
}
