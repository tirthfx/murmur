import Foundation

/// The OS side of microphone capture. The real one wraps AVAudioEngine; tests use a fake
/// that plays generated audio and never touches a microphone.
public protocol AudioInputSource: AnyObject, Sendable {
    /// Starts capture from the device with this UID, or the system default when nil.
    /// `onSamples` receives mono float samples and their sample rate, on the source's own
    /// queue. Returns the device name.
    func start(deviceUID: String?, onSamples: @escaping @Sendable ([Float], Double) -> Void) throws -> String
    /// Input devices now connected. Needs no permission.
    func listDevices() -> [AudioDevice]
    /// Stops capture. No `onSamples` call runs after this returns. Safe when not started.
    func stop()
}

public enum AudioSourceError: Error, Equatable {
    case noInputDevice
    case deviceNotFound
    case engine(String)
}

public struct AudioDevice: Sendable, Equatable {
    /// Stable Core Audio UID.
    public var id: String
    public var name: String
    public var isDefault: Bool
    /// `builtin`, `usb`, `bluetooth`, `virtual` or `other`.
    public var transport: String
    public var sampleRate: Int

    public init(id: String, name: String, isDefault: Bool, transport: String, sampleRate: Int) {
        self.id = id
        self.name = name
        self.isDefault = isDefault
        self.transport = transport
        self.sampleRate = sampleRate
    }
}

public enum AudioFailure: Error, Equatable {
    case invalidPayload(String)
    case busy(String)
    case notFound(String)
    case permissionDenied(String)
    case deviceNotFound(String)
    case engineFailed(String)

    public var code: ErrorCode {
        switch self {
        case .invalidPayload: return .invalidPayload
        case .busy: return .busy
        case .notFound: return .notFound
        case .permissionDenied: return .permissionDenied
        case .deviceNotFound: return .deviceNotFound
        case .engineFailed: return .audioEngineFailed
        }
    }

    public var message: String {
        switch self {
        case .invalidPayload(let text), .busy(let text), .notFound(let text), .permissionDenied(let text),
            .deviceNotFound(let text), .engineFailed(let text):
            return text
        }
    }
}

/// One microphone session at a time: `audio.start`, `audio.stop`, `audio.cancel`.
/// Audio is processed in the helper and written to a file; only levels, the silent warning
/// and the file reference reach main. Called from the stdin loop (requests) and from the
/// source's queue (samples).
public final class AudioCaptureController: @unchecked Sendable {
    // @unchecked: every mutable field is read and written only while `lock` is held, except
    // `source` calls, which are made from the stdin loop only.
    private let lock = NSLock()
    private var session: Session?
    private var generation = 0

    private let source: any AudioInputSource
    private let permissions: any PermissionProvider
    private let directory: URL
    private let emit: @Sendable (Envelope) -> Void
    private let now: @Sendable () -> Int
    private let fileManager = FileManager.default

    /// Temporary audio older than this is deleted when a new session starts.
    public static let tempFileMaxAge: TimeInterval = 24 * 60 * 60

    private final class Session {
        let id: String
        let generation: Int
        let deviceName: String
        let fileURL: URL
        let handle: FileHandle
        var pipeline: AudioPipeline
        var resampler: Resampler?
        var bytes = 0
        var writeFailed = false

        init(id: String, generation: Int, deviceName: String, fileURL: URL, handle: FileHandle, pipeline: AudioPipeline) {
            self.id = id
            self.generation = generation
            self.deviceName = deviceName
            self.fileURL = fileURL
            self.handle = handle
            self.pipeline = pipeline
        }
    }

    public init(
        source: any AudioInputSource,
        permissions: any PermissionProvider,
        directory: URL,
        emit: @escaping @Sendable (Envelope) -> Void,
        now: @escaping @Sendable () -> Int = { Int(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.source = source
        self.permissions = permissions
        self.directory = directory
        self.emit = emit
        self.now = now
    }

    public var isCapturing: Bool { lock.withLock { session != nil } }

    // MARK: Requests

    public func start(_ payload: [String: JSONValue]) -> Result<[String: JSONValue], AudioFailure> {
        guard let sessionId = Self.sessionId(payload) else {
            return .failure(.invalidPayload("sessionId must be 1 to 64 letters, digits or dashes"))
        }
        var deviceUID: String?
        if let deviceId = payload["deviceId"], deviceId != .null {
            guard let uid = deviceId.stringValue, !uid.isEmpty, uid.count <= 512 else {
                return .failure(.invalidPayload("deviceId must be a device id from audio.devices, or null"))
            }
            deviceUID = uid
        }
        var settings = AudioPipelineSettings()
        let emitLevels = payload["emitLevels"]?.boolValue ?? true
        let interval = payload["levelIntervalMs"]?.intValue ?? 100
        guard (20...5_000).contains(interval) else {
            return .failure(.invalidPayload("levelIntervalMs must be from 20 to 5000"))
        }
        settings.levelIntervalMs = emitLevels ? interval : 0

        if isCapturing { return .failure(.busy("A microphone session is already running")) }
        // Read the status only: starting the engine without permission would show a prompt.
        guard permissions.status(of: .microphone) == .granted else {
            return .failure(.permissionDenied("microphone: Microphone access is not granted"))
        }

        let fileURL: URL
        let handle: FileHandle
        do {
            try fileManager.createDirectory(
                at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            pruneOldFiles()
            fileURL = directory.appendingPathComponent("\(sessionId).pcm")
            guard fileManager.createFile(atPath: fileURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
            else { return .failure(.engineFailed("Could not create the audio file")) }
            handle = try FileHandle(forWritingTo: fileURL)
        } catch {
            return .failure(.engineFailed("Could not prepare the audio folder: \(error.localizedDescription)"))
        }

        let generation = lock.withLock { () -> Int in
            self.generation += 1
            return self.generation
        }
        let deviceName: String
        do {
            deviceName = try source.start(deviceUID: deviceUID) { [weak self] samples, rate in
                self?.receive(samples, rate: rate, generation: generation)
            }
        } catch {
            try? handle.close()
            try? fileManager.removeItem(at: fileURL)
            if case AudioSourceError.noInputDevice = error {
                return .failure(.deviceNotFound("No input device is connected"))
            }
            if case AudioSourceError.deviceNotFound = error {
                return .failure(.deviceNotFound("Selected input device is not connected"))
            }
            return .failure(.engineFailed("The microphone could not be started: \(error)"))
        }
        let startedAt = now()
        lock.withLock {
            session = Session(
                id: sessionId, generation: generation, deviceName: deviceName, fileURL: fileURL,
                handle: handle, pipeline: AudioPipeline(settings: settings))
        }
        Log.info("audio started on \(deviceName)")
        return .success([
            "startedAt": .int(startedAt),
            "sampleRate": .int(AudioFormat.sampleRate),
            "channels": .int(AudioFormat.channels),
            "deviceName": .string(deviceName),
        ])
    }

    public func stop(_ payload: [String: JSONValue]) -> Result<[String: JSONValue], AudioFailure> {
        switch end(payload) {
        case .failure(let failure):
            return .failure(failure)
        case .success(let finished):
            let pipeline = finished.pipeline
            var audioFile: JSONValue = .null
            if finished.bytes > 0 && !finished.writeFailed {
                audioFile = .object([
                    "path": .string(finished.fileURL.path),
                    "codec": .string(AudioFormat.codec),
                    "bytes": .int(finished.bytes),
                ])
            } else {
                try? fileManager.removeItem(at: finished.fileURL)
            }
            Log.info("audio stopped after \(pipeline.durationMs) ms")
            return .success([
                "durationMs": .int(pipeline.durationMs),
                "samples": .int(pipeline.totalSamples),
                "peakDb": .double(Decibels.rounded(pipeline.peakDb)),
                "meanDb": .double(Decibels.rounded(pipeline.meanDb)),
                "silent": .bool(!pipeline.heardInput),
                "audioFile": audioFile,
            ])
        }
    }

    public func cancel(_ payload: [String: JSONValue]) -> Result<[String: JSONValue], AudioFailure> {
        switch end(payload) {
        case .failure(let failure):
            return .failure(failure)
        case .success(let finished):
            try? fileManager.removeItem(at: finished.fileURL)
            Log.info("audio cancelled")
            return .success(["discarded": .bool(true)])
        }
    }

    /// `audio.devices`: the connected input devices.
    public func devices() -> [String: JSONValue] {
        .init(uniqueKeysWithValues: [
            (
                "devices",
                JSONValue.array(
                    source.listDevices().map {
                        .object([
                            "id": .string($0.id), "name": .string($0.name), "isDefault": .bool($0.isDefault),
                            "transport": .string($0.transport), "sampleRate": .int($0.sampleRate),
                        ])
                    })
            )
        ])
    }

    /// Ends any running session and deletes its file. Used at shutdown.
    public func shutdown() {
        guard let current = lock.withLock({ session }) else { return }
        _ = cancel(["sessionId": .string(current.id)])
    }

    // MARK: Internals

    private func end(_ payload: [String: JSONValue]) -> Result<Session, AudioFailure> {
        guard let sessionId = Self.sessionId(payload) else {
            return .failure(.invalidPayload("sessionId must be 1 to 64 letters, digits or dashes"))
        }
        guard lock.withLock({ session?.id == sessionId }) else {
            return .failure(.notFound("No microphone session with this id is running"))
        }
        // Outside the lock: stop waits for the last sample callback, which takes the lock.
        source.stop()
        return lock.withLock { () -> Result<Session, AudioFailure> in
            guard let current = session else { return .failure(.notFound("The session already ended")) }
            session = nil
            generation += 1
            let flushed = current.pipeline.process(current.resampler?.flush() ?? [])
            let rest = current.pipeline.finish()
            write(flushed.output + rest.output, to: current)
            send(flushed.events + rest.events, for: current)
            try? current.handle.close()
            return .success(current)
        }
    }

    private func receive(_ samples: [Float], rate: Double, generation: Int) {
        lock.withLock {
            guard let current = session, current.generation == generation else { return }
            if current.resampler?.inputRate != rate {
                current.resampler = try? Resampler(inputRate: rate)
            }
            guard let resampler = current.resampler else { return }
            let (output, events) = current.pipeline.process(resampler.process(samples))
            write(output, to: current)
            send(events, for: current)
        }
    }

    /// Called with `lock` held.
    private func write(_ samples: [Float], to session: Session) {
        guard !samples.isEmpty, !session.writeFailed else { return }
        let data = AudioPipeline.pcm16(samples)
        do {
            try session.handle.write(contentsOf: data)
            session.bytes += data.count
        } catch {
            session.writeFailed = true
            Log.info("audio file write failed: \(error.localizedDescription)")
        }
    }

    /// Called with `lock` held. `emit` only queues the line, so this does not block.
    private func send(_ events: [AudioPipelineEvent], for session: Session) {
        for event in events {
            switch event {
            case .level(let rmsDb, let peakDb):
                emit(
                    Envelope(
                        id: nil, type: "audio.level",
                        payload: [
                            "sessionId": .string(session.id), "source": .string("mic"),
                            "rmsDb": .double(rmsDb), "peakDb": .double(peakDb), "at": .int(now()),
                        ]))
            case .silent(let elapsedMs):
                emit(
                    Envelope(
                        id: nil, type: "audio.silent",
                        payload: [
                            "sessionId": .string(session.id), "elapsedMs": .int(elapsedMs),
                            "deviceName": .string(session.deviceName),
                        ]))
            }
        }
    }

    private func pruneOldFiles() {
        guard
            let files = try? fileManager.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: [.contentModificationDateKey])
        else { return }
        let cutoff = Date().addingTimeInterval(-Self.tempFileMaxAge)
        for file in files where file.pathExtension == "pcm" {
            let modified = (try? file.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            if let modified, modified < cutoff { try? fileManager.removeItem(at: file) }
        }
    }

    /// Session ids become file names, so only a safe character set is accepted.
    static func sessionId(_ payload: [String: JSONValue]) -> String? {
        guard let id = payload["sessionId"]?.stringValue, (1...64).contains(id.count),
            id.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") })
        else { return nil }
        return id
    }
}
