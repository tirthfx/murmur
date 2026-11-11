import AVFoundation
import Foundation

/// Plays an audio file as if it were the microphone. Only for tests: the helper uses it when
/// `MURMUR_AUDIO_FIXTURE` names a file, so the whole dictation path can run on a known clip
/// without a microphone or its permission.
public final class FileAudioSource: AudioInputSource, @unchecked Sendable {
    // @unchecked: `running` and `worker` are guarded by `lock`.
    private let url: URL
    private let realTime: Bool
    private let lock = NSLock()
    private var running = false
    private var worker: Thread?
    private var finished = DispatchSemaphore(value: 0)

    public static let deviceId = "murmur.fixture"

    /// `realTime` paces the samples like a live input and keeps sending silence after the
    /// clip ends. Without it the clip is delivered as fast as it can be read, then nothing.
    public init(url: URL, realTime: Bool = true) {
        self.url = url
        self.realTime = realTime
    }

    public func start(deviceUID: String?, onSamples: @escaping @Sendable ([Float], Double) -> Void) throws -> String {
        stop()
        let (samples, rate) = try Self.readMono(url)
        let done = DispatchSemaphore(value: 0)
        lock.lock()
        running = true
        finished = done
        lock.unlock()

        let chunk = 4096
        let realTime = self.realTime
        let thread = Thread { [weak self] in
            defer { done.signal() }
            var offset = 0
            while let self, self.isActive {
                let slice: [Float]
                if offset < samples.count {
                    slice = Array(samples[offset..<min(offset + chunk, samples.count)])
                } else if realTime {
                    slice = [Float](repeating: 0, count: chunk)
                } else {
                    return
                }
                offset += slice.count
                onSamples(slice, rate)
                if realTime { Thread.sleep(forTimeInterval: Double(slice.count) / rate) }
            }
        }
        lock.lock()
        worker = thread
        lock.unlock()
        thread.start()
        return "Fixture clip (\(url.lastPathComponent))"
    }

    public func stop() {
        lock.lock()
        let wasRunning = running
        let done = finished
        running = false
        worker = nil
        lock.unlock()
        // Wait for the worker, so no `onSamples` call runs after this returns.
        if wasRunning { done.wait() }
    }

    /// Blocks until a clip started without `realTime` has been delivered. For tests.
    public func waitUntilFinished() {
        lock.lock()
        let done = finished
        lock.unlock()
        done.wait()
        done.signal()
    }

    public func listDevices() -> [AudioDevice] {
        [AudioDevice(id: Self.deviceId, name: "Fixture clip", isDefault: true, transport: "virtual", sampleRate: 16_000)]
    }

    private var isActive: Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }

    /// The whole file as mono float samples, with its sample rate.
    static func readMono(_ url: URL) throws -> ([Float], Double) {
        let file: AVAudioFile
        do {
            file = try AVAudioFile(forReading: url)
        } catch {
            throw AudioSourceError.engine("The fixture clip could not be read: \(error.localizedDescription)")
        }
        let format = file.processingFormat
        let frames = AVAudioFrameCount(file.length)
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else {
            throw AudioSourceError.engine("The fixture clip is empty")
        }
        do {
            try file.read(into: buffer)
        } catch {
            throw AudioSourceError.engine("The fixture clip could not be read: \(error.localizedDescription)")
        }
        guard let channels = buffer.floatChannelData else {
            throw AudioSourceError.engine("The fixture clip is not in a float format")
        }
        let count = Int(buffer.frameLength)
        let channelCount = Int(format.channelCount)
        var mono = [Float](repeating: 0, count: count)
        for channel in 0..<channelCount {
            let data = channels[channel]
            for index in 0..<count { mono[index] += data[index] }
        }
        if channelCount > 1 {
            let scale = 1 / Float(channelCount)
            for index in 0..<count { mono[index] *= scale }
        }
        return (mono, format.sampleRate)
    }
}

/// Reports the microphone as granted while a fixture clip stands in for it; everything else
/// comes from the real provider. Never used outside fixture mode.
public struct FixturePermissionProvider: PermissionProvider {
    private let base: any PermissionProvider

    public init(base: any PermissionProvider) {
        self.base = base
    }

    public func status(of kind: PermissionKind) -> PermissionStatus {
        kind == .microphone ? .granted : base.status(of: kind)
    }

    public func request(_ kind: PermissionKind) -> PermissionStatus {
        kind == .microphone ? .granted : base.request(kind)
    }
}
