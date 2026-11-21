@preconcurrency import AVFoundation
import CoreMedia
import Foundation
@preconcurrency import ScreenCaptureKit

/// The meeting's microphone channel. It has its own engine, so a dictation can run at the
/// same time (NT-19). When the device goes away it carries on with the system default and
/// reports `device_lost`.
public final class MicChannelSource: MeetingChannelSource, @unchecked Sendable {
    // @unchecked: the callbacks are guarded by `lock`; the engine is only used from `queue`.
    private let engine: any AudioInputSource
    private let queue = DispatchQueue(label: "murmur.meeting.mic")
    private let lock = NSLock()
    private var samples: (@Sendable ([Float], Double) -> Void)?
    private var issues: (@Sendable (String) -> Void)?
    private var token = 0

    public init(engine: any AudioInputSource = EngineAudioSource()) {
        self.engine = engine
        engine.onChange { [weak self] in self?.changed() }
    }

    public func start(
        deviceUID: String?, onSamples: @escaping @Sendable ([Float], Double) -> Void,
        onIssue: @escaping @Sendable (String) -> Void
    ) throws -> String {
        lock.withLock {
            samples = onSamples
            issues = onIssue
        }
        return try queue.sync { try engine.start(deviceUID: deviceUID, onSamples: forward) }
    }

    public func stop() {
        lock.withLock {
            samples = nil
            issues = nil
            token += 1
        }
        queue.sync { engine.stop() }
    }

    private var forward: @Sendable ([Float], Double) -> Void {
        { [weak self] values, rate in self?.lock.withLock { self?.samples }?(values, rate) }
    }

    private func changed() {
        let current = lock.withLock { () -> Int? in
            guard samples != nil else { return nil }
            token += 1
            return token
        }
        guard let current else { return }
        queue.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self, self.lock.withLock({ self.token == current && self.samples != nil }) else { return }
            let running = self.engine.runningDeviceUID
            let present = running.map { uid in self.engine.listDevices().contains { $0.id == uid } } ?? true
            guard !present || !self.engine.isRunning else { return }
            self.engine.stop()
            let name = try? self.engine.start(deviceUID: nil, onSamples: self.forward)
            Log.info("meeting microphone changed; now \(name ?? "nothing")")
            self.lock.withLock { self.issues }?("device_lost")
        }
    }
}

/// The Mac's own sound through ScreenCaptureKit, audio only. Screen Recording permission is
/// needed even though no picture is kept: the stream asks for the smallest frames and drops
/// them. The helper's own sound is left out.
public final class SystemAudioSource: NSObject, MeetingChannelSource, SCStreamOutput, SCStreamDelegate,
    @unchecked Sendable
{
    // @unchecked: `stream` and the callbacks are guarded by `lock`.
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "murmur.meeting.system")
    private var stream: SCStream?
    private var samples: (@Sendable ([Float], Double) -> Void)?
    private var issues: (@Sendable (String) -> Void)?

    override public init() { super.init() }

    final class Box<T>: @unchecked Sendable {
        var value: T?
    }

    public func start(
        deviceUID: String?, onSamples: @escaping @Sendable ([Float], Double) -> Void,
        onIssue: @escaping @Sendable (String) -> Void
    ) throws -> String {
        stop()
        lock.withLock {
            samples = onSamples
            issues = onIssue
        }
        let done = DispatchSemaphore(value: 0)
        let found = Box<Result<SCShareableContent, any Error>>()
        SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) { content, error in
            if let content { found.value = .success(content) } else {
                found.value = .failure(error ?? AudioSourceError.engine("No shareable content"))
            }
            done.signal()
        }
        guard done.wait(timeout: .now() + 8) == .success, let result = found.value else {
            throw AudioSourceError.engine("Screen content did not answer")
        }
        guard let display = try result.get().displays.first else {
            throw AudioSourceError.engine("No display")
        }
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.capturesAudio = true
        configuration.excludesCurrentProcessAudio = true
        configuration.sampleRate = 48_000
        configuration.channelCount = 1
        configuration.width = 2
        configuration.height = 2
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        configuration.queueDepth = 3
        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        let failure = Box<any Error>()
        stream.startCapture { error in
            failure.value = error
            done.signal()
        }
        guard done.wait(timeout: .now() + 8) == .success else {
            throw AudioSourceError.engine("System sound did not start")
        }
        if let error = failure.value { throw AudioSourceError.engine(error.localizedDescription) }
        lock.withLock { self.stream = stream }
        return "System sound"
    }

    public func stop() {
        let running = lock.withLock { () -> SCStream? in
            let current = stream
            stream = nil
            samples = nil
            issues = nil
            return current
        }
        guard let running else { return }
        let done = DispatchSemaphore(value: 0)
        running.stopCapture { _ in done.signal() }
        _ = done.wait(timeout: .now() + 3)
        queue.sync {}
    }

    public func stream(_ stream: SCStream, didStopWithError error: any Error) {
        Log.info("system sound stream stopped: \(error.localizedDescription)")
        let report = lock.withLock { () -> (@Sendable (String) -> Void)? in
            guard self.stream === stream else { return nil }
            self.stream = nil
            return issues
        }
        report?("sck_stream_stopped")
    }

    public func stream(
        _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType
    ) {
        guard type == .audio, sampleBuffer.isValid, let handler = lock.withLock({ samples }),
            let description = sampleBuffer.formatDescription,
            let basic = CMAudioFormatDescriptionGetStreamBasicDescription(description)?.pointee,
            basic.mFormatFlags & kAudioFormatFlagIsFloat != 0, basic.mBitsPerChannel == 32
        else { return }
        let interleaved = basic.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
        let channels = max(1, Int(basic.mChannelsPerFrame))
        var mono: [Float] = []
        try? sampleBuffer.withAudioBufferList { list, _ in
            if interleaved {
                guard let buffer = list.first, let data = buffer.mData else { return }
                let values = data.assumingMemoryBound(to: Float.self)
                let frames = Int(buffer.mDataByteSize) / (4 * channels)
                mono = (0..<frames).map { frame in
                    var sum: Float = 0
                    for channel in 0..<channels { sum += values[frame * channels + channel] }
                    return sum / Float(channels)
                }
            } else {
                let buffers = Array(list)
                guard let first = buffers.first else { return }
                let frames = Int(first.mDataByteSize) / 4
                mono = [Float](repeating: 0, count: frames)
                for buffer in buffers {
                    guard let data = buffer.mData else { continue }
                    let values = data.assumingMemoryBound(to: Float.self)
                    for frame in 0..<min(frames, Int(buffer.mDataByteSize) / 4) { mono[frame] += values[frame] }
                }
                if buffers.count > 1 {
                    let scale = 1 / Float(buffers.count)
                    for frame in 0..<frames { mono[frame] *= scale }
                }
            }
        }
        if !mono.isEmpty { handler(mono, basic.mSampleRate) }
    }
}

/// AAC in `.m4a`, 16 kHz mono at 32 kbps (NT-04).
public struct AACChunkEncoder: ChunkEncoder {
    public init() {}
    public var fileExtension: String { "m4a" }

    public func open(url: URL) throws -> any ChunkFile { try AACChunkFile(url: url) }
}

final class AACChunkFile: ChunkFile {
    private var file: AVAudioFile?

    init(url: URL) throws {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: Double(AudioFormat.sampleRate),
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32_000,
        ]
        file = try AVAudioFile(forWriting: url, settings: settings, commonFormat: .pcmFormatFloat32, interleaved: false)
    }

    func append(_ samples: [Float]) throws {
        guard let file, !samples.isEmpty,
            let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(samples.count))
        else { return }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            buffer.floatChannelData![0].update(from: source.baseAddress!, count: samples.count)
        }
        try file.write(from: buffer)
    }

    /// AVAudioFile finishes the file when it is released.
    func close() { file = nil }
}
