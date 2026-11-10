import CoreAudio
import Foundation

/// The system output's mute switch. Tests use a fake.
public protocol OutputMuteControl: Sendable {
    /// Nil when the default output device has no mute switch Murmur can read.
    func isMuted() -> Bool?
    /// Returns false when the switch could not be set.
    func setMuted(_ muted: Bool) -> Bool
}

/// `media.status` and `media.mute` (DC-41). Main decides when; the helper only reads and sets.
public struct MediaController: Sendable {
    let output: any OutputMuteControl

    public init(output: any OutputMuteControl) { self.output = output }

    public func status() -> [String: JSONValue] {
        ["playing": .string("unknown"), "outputMuted": output.isMuted().map { .bool($0) } ?? .null]
    }

    /// Sets the mute switch and returns what it was before.
    public func mute(_ payload: [String: JSONValue]) -> Result<[String: JSONValue], AudioFailure> {
        guard let muted = payload["muted"]?.boolValue else {
            return .failure(.invalidPayload("media.mute needs muted (bool)"))
        }
        guard let previous = output.isMuted() else {
            return .failure(.deviceNotFound("The output device has no mute switch"))
        }
        if previous != muted, !output.setMuted(muted) {
            return .failure(.engineFailed("The output could not be muted"))
        }
        return .success(["previousMuted": .bool(previous)])
    }
}

/// The default output device's mute property through Core Audio. No permission needed.
public struct SystemOutputMute: OutputMuteControl {
    public init() {}

    private static func defaultOutput() -> AudioDeviceID? {
        var device = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
        return status == noErr && device != 0 ? device : nil
    }

    private static var muteAddress: AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyMute, mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain)
    }

    public func isMuted() -> Bool? {
        guard let device = Self.defaultOutput() else { return nil }
        var address = Self.muteAddress
        guard AudioObjectHasProperty(device, &address) else { return nil }
        var value = UInt32(0)
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value != 0
    }

    public func setMuted(_ muted: Bool) -> Bool {
        guard let device = Self.defaultOutput() else { return false }
        var address = Self.muteAddress
        var value = UInt32(muted ? 1 : 0)
        return AudioObjectSetPropertyData(device, &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &value) == noErr
    }
}
