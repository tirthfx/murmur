@preconcurrency import AVFoundation
import CoreAudio
import Foundation

/// Microphone capture from the system default input with AVAudioEngine. The caller checks
/// the microphone permission first: starting the engine without it would show a prompt.
public final class EngineAudioSource: AudioInputSource, @unchecked Sendable {
    // @unchecked: `engine` is only touched from the stdin loop (start and stop).
    private var engine: AVAudioEngine?
    private let queue = DispatchQueue(label: "murmur.audio.samples")

    public init() {}

    public func start(onSamples: @escaping @Sendable ([Float], Double) -> Void) throws -> String {
        stop()
        guard let device = Self.defaultInputDevice() else { throw AudioSourceError.noInputDevice }
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw AudioSourceError.noInputDevice }

        let queue = self.queue
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            guard let channels = buffer.floatChannelData else { return }
            let frames = Int(buffer.frameLength)
            let count = Int(buffer.format.channelCount)
            // Down-mix to mono by averaging the channels.
            var mono = [Float](repeating: 0, count: frames)
            for channel in 0..<count {
                let data = channels[channel]
                for index in 0..<frames { mono[index] += data[index] }
            }
            if count > 1 {
                let scale = 1 / Float(count)
                for index in 0..<frames { mono[index] *= scale }
            }
            let rate = buffer.format.sampleRate
            let samples = mono
            queue.async { onSamples(samples, rate) }
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            input.removeTap(onBus: 0)
            throw AudioSourceError.engine(error.localizedDescription)
        }
        self.engine = engine
        return Self.deviceName(device) ?? "Default microphone"
    }

    public func stop() {
        guard let engine else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        self.engine = nil
        // Let callbacks already queued finish, so none runs after this returns.
        queue.sync {}
    }

    // MARK: Core Audio lookups (no permission needed, no prompt)

    static func defaultInputDevice() -> AudioDeviceID? {
        var device = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
        return status == noErr && device != 0 ? device : nil
    }

    static func deviceName(_ device: AudioDeviceID) -> String? {
        var name: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioObjectPropertyName,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        let status = withUnsafeMutablePointer(to: &name) { pointer in
            AudioObjectGetPropertyData(device, &address, 0, nil, &size, pointer)
        }
        guard status == noErr, let value = name?.takeRetainedValue() else { return nil }
        return value as String
    }
}
