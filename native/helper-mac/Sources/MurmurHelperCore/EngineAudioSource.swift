@preconcurrency import AVFoundation
import CoreAudio
import Foundation

/// Microphone capture with AVAudioEngine, from the system default input or a chosen device.
/// The caller checks the microphone permission first: starting the engine without it would
/// show a prompt. Device lookups use Core Audio, which needs no permission.
public final class EngineAudioSource: AudioInputSource, @unchecked Sendable {
    // @unchecked: `engine` is only touched from the stdin loop (start and stop).
    private var engine: AVAudioEngine?
    private let queue = DispatchQueue(label: "murmur.audio.samples")

    public init() {}

    public func start(deviceUID: String?, onSamples: @escaping @Sendable ([Float], Double) -> Void) throws -> String {
        stop()
        let device: AudioDeviceID
        if let deviceUID {
            guard let found = Self.inputDevices().first(where: { $0.uid == deviceUID }) else {
                throw AudioSourceError.deviceNotFound
            }
            device = found.id
        } else {
            guard let fallback = Self.defaultInputDevice() else { throw AudioSourceError.noInputDevice }
            device = fallback
        }
        let engine = AVAudioEngine()
        let input = engine.inputNode
        if deviceUID != nil {
            guard let unit = input.audioUnit else { throw AudioSourceError.engine("No input unit") }
            var chosen = device
            let status = AudioUnitSetProperty(
                unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &chosen,
                UInt32(MemoryLayout<AudioDeviceID>.size))
            guard status == noErr else { throw AudioSourceError.engine("Could not select the device (\(status))") }
        }
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

    public func listDevices() -> [AudioDevice] {
        let defaultId = Self.defaultInputDevice()
        return Self.inputDevices().map { device in
            AudioDevice(
                id: device.uid, name: Self.deviceName(device.id) ?? "Microphone",
                isDefault: device.id == defaultId, transport: Self.transport(device.id),
                sampleRate: Self.sampleRate(device.id))
        }
    }

    // MARK: Core Audio lookups (no permission needed, no prompt)

    private static func property<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal, initial: T) -> T? {
        var value = initial
        var size = UInt32(MemoryLayout<T>.size)
        var address = AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
        let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0) }
        return status == noErr ? value : nil
    }

    /// Every device with at least one input stream, with its stable UID.
    static func inputDevices() -> [(id: AudioDeviceID, uid: String)] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        let system = AudioObjectID(kAudioObjectSystemObject)
        guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
        var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids) == noErr else { return [] }
        return ids.compactMap { id in
            var streams = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyStreams, mScope: kAudioObjectPropertyScopeInput,
                mElement: kAudioObjectPropertyElementMain)
            var streamSize: UInt32 = 0
            guard AudioObjectGetPropertyDataSize(id, &streams, 0, nil, &streamSize) == noErr, streamSize > 0 else {
                return nil
            }
            var uid: Unmanaged<CFString>?
            guard let found = property(id, kAudioDevicePropertyDeviceUID, initial: uid), let value = found else {
                return nil
            }
            uid = value
            return (id, value.takeRetainedValue() as String)
        }
    }

    static func transport(_ device: AudioDeviceID) -> String {
        switch property(device, kAudioDevicePropertyTransportType, initial: UInt32(0)) ?? 0 {
        case kAudioDeviceTransportTypeBuiltIn: return "builtin"
        case kAudioDeviceTransportTypeUSB: return "usb"
        case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return "bluetooth"
        case kAudioDeviceTransportTypeVirtual, kAudioDeviceTransportTypeAggregate, kAudioDeviceTransportTypeAutoAggregate:
            return "virtual"
        default: return "other"
        }
    }

    static func sampleRate(_ device: AudioDeviceID) -> Int {
        Int(property(device, kAudioDevicePropertyNominalSampleRate, initial: Float64(0)) ?? 0)
    }

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
