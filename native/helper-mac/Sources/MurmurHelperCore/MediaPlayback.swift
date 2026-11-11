import Foundation

/// Now-playing control (DC-42, experimental). Tests use a fake.
public protocol NowPlayingControl: Sendable {
    /// Nil when the system does not tell this app what is playing.
    func isPlaying() -> Bool?
    /// Returns false when the command could not be sent.
    func pause() -> Bool
    func play() -> Bool
}

/// `media.playback`, `media.pause` and `media.resume`. Pause acts only when something is
/// playing and says so, so main resumes only what Murmur paused.
public struct PlaybackController: Sendable {
    let control: any NowPlayingControl

    public init(control: any NowPlayingControl) { self.control = control }

    public func handle(type: String) -> Result<[String: JSONValue], AudioFailure> {
        switch type {
        case "media.playback":
            let playing = control.isPlaying()
            return .success(["available": .bool(playing != nil), "playing": playing.map { .bool($0) } ?? .null])
        case "media.pause":
            guard let playing = control.isPlaying() else {
                return .failure(.deviceNotFound("The system does not report what is playing"))
            }
            guard playing else { return .success(["paused": .bool(false)]) }
            return .success(["paused": .bool(control.pause())])
        case "media.resume":
            guard control.isPlaying() != nil else {
                return .failure(.deviceNotFound("The system does not report what is playing"))
            }
            return .success(["resumed": .bool(control.play())])
        default:
            return .failure(.invalidPayload("Unknown media request"))
        }
    }
}

/// The system's now-playing service, loaded at run time. Recent macOS versions keep it from
/// most apps; then every call reports "not available" and nothing is sent.
public final class SystemNowPlaying: NowPlayingControl, @unchecked Sendable {
    // @unchecked: the function pointers are set once in init and only read afterwards.
    private typealias IsPlayingFunction = @convention(c) (
        DispatchQueue, @escaping @convention(block) (Bool) -> Void
    ) -> Void
    private typealias SendCommandFunction = @convention(c) (UInt32, CFDictionary?) -> Bool

    private let isPlayingFunction: IsPlayingFunction?
    private let sendCommand: SendCommandFunction?
    private static let commandPlay: UInt32 = 0
    private static let commandPause: UInt32 = 1

    public init() {
        let handle = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_LAZY)
        isPlayingFunction = handle.flatMap { dlsym($0, "MRMediaRemoteGetNowPlayingApplicationIsPlaying") }
            .map { unsafeBitCast($0, to: IsPlayingFunction.self) }
        sendCommand = handle.flatMap { dlsym($0, "MRMediaRemoteSendCommand") }
            .map { unsafeBitCast($0, to: SendCommandFunction.self) }
    }

    public func isPlaying() -> Bool? {
        guard let isPlayingFunction else { return nil }
        let answer = Answer()
        let done = DispatchSemaphore(value: 0)
        isPlayingFunction(DispatchQueue.global(qos: .userInitiated)) { playing in
            answer.set(playing)
            done.signal()
        }
        // No answer in time means the service is not talking to this app.
        guard done.wait(timeout: .now() + 0.5) == .success else { return nil }
        return answer.value
    }

    public func pause() -> Bool { sendCommand?(Self.commandPause, nil) ?? false }
    public func play() -> Bool { sendCommand?(Self.commandPlay, nil) ?? false }

    private final class Answer: @unchecked Sendable {
        private let lock = NSLock()
        private var stored = false
        var value: Bool { lock.withLock { stored } }
        func set(_ value: Bool) { lock.withLock { stored = value } }
    }
}
