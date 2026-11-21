import CryptoKit
import Foundation

/// One channel of a meeting recording: the microphone or the Mac's own sound. The real ones
/// wrap AVAudioEngine and ScreenCaptureKit; tests use fakes.
public protocol MeetingChannelSource: AnyObject, Sendable {
    /// Starts capture. `onSamples` gets mono float samples and their rate. `onIssue` gets a
    /// protocol code (`device_lost`, `sck_stream_stopped`) when the source had trouble; the
    /// source keeps going where it can. Returns a name for the device.
    func start(
        deviceUID: String?, onSamples: @escaping @Sendable ([Float], Double) -> Void,
        onIssue: @escaping @Sendable (String) -> Void
    ) throws -> String
    /// Stops capture. No callback runs after this returns. Safe when not started.
    func stop()
}

/// Writes one chunk file. The real one encodes AAC in an `.m4a` file.
public protocol ChunkFile: AnyObject {
    func append(_ samples: [Float]) throws
    /// Finishes the file. Nothing is written after this.
    func close()
}

public protocol ChunkEncoder: Sendable {
    /// The file extension the encoder writes, without the dot.
    var fileExtension: String { get }
    func open(url: URL) throws -> any ChunkFile
}

/// `capture.start`, `capture.stop` (NT-04): a meeting's microphone and system sound, each in
/// its own chunk files of `chunkSeconds`, 16 kHz mono. Every finished chunk is reported with
/// `capture.chunk` (path, size, SHA-256), so a crash loses at most the chunk being written.
/// A channel that falls behind the wall clock (a device switch, a silent system stream) is
/// filled with silence, so both channels stay on the meeting's timeline.
public final class MeetingCaptureController: @unchecked Sendable {
    // @unchecked: mutable state is only touched while `lock` is held.
    private let lock = NSLock()
    private let mic: any MeetingChannelSource
    private let system: any MeetingChannelSource
    private let permissions: any PermissionProvider
    private let encoder: any ChunkEncoder
    private let emit: @Sendable (Envelope) -> Void
    private let now: @Sendable () -> Int
    private let fileManager = FileManager.default
    private let tickInterval: TimeInterval?
    private var timer: DispatchSourceTimer?
    private var session: Session?

    static let sampleRate = AudioFormat.sampleRate
    /// Samples per level report: 200 ms, so about five a second.
    static let levelSamples = sampleRate / 5
    /// A channel this far behind the wall clock is filled with silence.
    static let lagLimitSamples = sampleRate * 3 / 2
    /// How far behind the clock filling stops, for audio still on its way.
    static let lagKeepSamples = sampleRate / 4

    final class Channel {
        let name: String
        var resampler: Resampler?
        var file: (any ChunkFile)?
        var fileURL: URL?
        var seq = 0
        var inChunk = 0
        var chunkStart = 0
        var total = 0
        var chunks = 0
        var failed = false
        var levelSum: Double = 0
        var levelCount = 0

        init(name: String) { self.name = name }
    }

    final class Session {
        let meetingId: String
        let folder: URL
        let chunkSamples: Int
        let startedAt: Int
        var channels: [String: Channel] = [:]

        init(meetingId: String, folder: URL, chunkSamples: Int, startedAt: Int) {
            self.meetingId = meetingId
            self.folder = folder
            self.chunkSamples = chunkSamples
            self.startedAt = startedAt
        }
    }

    public init(
        mic: any MeetingChannelSource,
        system: any MeetingChannelSource,
        permissions: any PermissionProvider,
        encoder: any ChunkEncoder,
        emit: @escaping @Sendable (Envelope) -> Void,
        now: @escaping @Sendable () -> Int = { Int(Date().timeIntervalSince1970 * 1000) },
        tickInterval: TimeInterval? = 1
    ) {
        self.mic = mic
        self.system = system
        self.permissions = permissions
        self.encoder = encoder
        self.emit = emit
        self.now = now
        self.tickInterval = tickInterval
    }

    public var isCapturing: Bool { lock.withLock { session != nil } }

    // MARK: Requests

    public func start(_ payload: [String: JSONValue]) -> Result<[String: JSONValue], AudioFailure> {
        guard let meetingId = AudioCaptureController.sessionId(["sessionId": payload["meetingId"] ?? .null]) else {
            return .failure(.invalidPayload("meetingId must be 1 to 64 letters, digits or dashes"))
        }
        guard let folderPath = payload["folder"]?.stringValue, let folder = Self.folder(folderPath) else {
            return .failure(.invalidPayload("folder must be an absolute path without .. parts"))
        }
        let chunkSeconds = payload["chunkSeconds"]?.intValue ?? 30
        guard (1...300).contains(chunkSeconds) else {
            return .failure(.invalidPayload("chunkSeconds must be from 1 to 300"))
        }
        var wanted = ["mic", "system"]
        if let list = payload["channels"] {
            guard case .array(let values) = list else {
                return .failure(.invalidPayload("channels must be a list of mic and system"))
            }
            let names = values.compactMap(\.stringValue)
            guard names.count == values.count, !names.isEmpty, Set(names).isSubset(of: ["mic", "system"]) else {
                return .failure(.invalidPayload("channels must be a list of mic and system"))
            }
            wanted = ["mic", "system"].filter(names.contains)
        }
        var deviceUID: String?
        if let device = payload["micDeviceId"], device != .null {
            guard let uid = device.stringValue, !uid.isEmpty, uid.count <= 512 else {
                return .failure(.invalidPayload("micDeviceId must be a device id, or null"))
            }
            deviceUID = uid
        }
        if isCapturing { return .failure(.busy("A meeting is already being recorded")) }
        if wanted.contains("mic"), permissions.status(of: .microphone) != .granted {
            return .failure(.permissionDenied("microphone: Microphone access is not granted"))
        }
        do {
            try fileManager.createDirectory(
                at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        } catch {
            return .failure(.engineFailed("Could not create the meeting folder: \(error.localizedDescription)"))
        }

        let startedAt = now()
        let current = Session(
            meetingId: meetingId, folder: folder, chunkSamples: chunkSeconds * Self.sampleRate, startedAt: startedAt)
        lock.withLock { session = current }

        var started: [String: JSONValue] = [:]
        var warnings: [JSONValue] = []
        for name in wanted {
            if name == "system" && permissions.status(of: .screenRecording) != .granted {
                warnings.append(.string("system_permission"))
                continue
            }
            let source = name == "mic" ? mic : system
            lock.withLock { current.channels[name] = Channel(name: name) }
            do {
                let device = try source.start(
                    deviceUID: name == "mic" ? deviceUID : nil,
                    onSamples: { [weak self] samples, rate in
                        self?.receive(samples, rate: rate, channel: name, meetingId: meetingId)
                    },
                    onIssue: { [weak self] code in self?.issue(code, channel: name, meetingId: meetingId) })
                started[name] = .string(device)
            } catch {
                lock.withLock { _ = current.channels.removeValue(forKey: name) }
                if name == "mic" {
                    stopSources()
                    lock.withLock { session = nil }
                    if case AudioSourceError.noInputDevice = error {
                        return .failure(.deviceNotFound("No input device is connected"))
                    }
                    return .failure(.engineFailed("The microphone could not be started: \(error)"))
                }
                Log.info("meeting system sound could not start: \(error)")
                warnings.append(.string("system_unavailable"))
            }
        }
        if started.isEmpty {
            lock.withLock { session = nil }
            return .failure(.engineFailed("No channel could be started"))
        }
        startTimer()
        Log.info("meeting capture started (\(started.keys.sorted().joined(separator: ", ")))")
        return .success([
            "startedAt": .int(startedAt),
            "channels": .object(started),
            "sampleRate": .int(Self.sampleRate),
            "warnings": .array(warnings),
        ])
    }

    public func stop(_ payload: [String: JSONValue]) -> Result<[String: JSONValue], AudioFailure> {
        guard let meetingId = payload["meetingId"]?.stringValue else {
            return .failure(.invalidPayload("meetingId is required"))
        }
        guard lock.withLock({ session?.meetingId == meetingId }) else {
            return .failure(.notFound("No meeting with this id is being recorded"))
        }
        stopTimer()
        // Outside the lock: stopping waits for the last sample callback, which takes it.
        stopSources()
        let summary = lock.withLock { () -> [String: JSONValue] in
            guard let current = session else { return [:] }
            session = nil
            let elapsed = elapsedSamples(current)
            var channels: [String: JSONValue] = [:]
            for channel in current.channels.values {
                if let rest = channel.resampler?.flush(), !rest.isEmpty { append(rest, to: channel, in: current) }
                // Fill to the clock, so both channels end where the meeting ended.
                if channel.total < elapsed - Self.lagKeepSamples { pad(elapsed - channel.total, channel, current) }
                finishChunk(channel, in: current)
                channels[channel.name] = .object([
                    "chunks": .int(channel.chunks), "durationMs": .int(channel.total * 1000 / Self.sampleRate),
                ])
            }
            return [
                "durationMs": .int(now() - current.startedAt),
                "channels": .object(channels),
            ]
        }
        Log.info("meeting capture stopped")
        return .success(summary)
    }

    /// Stops a running recording and keeps what was written. Used at shutdown.
    public func shutdown() {
        guard let id = lock.withLock({ session?.meetingId }) else { return }
        _ = stop(["meetingId": .string(id)])
    }

    /// Fills channels that fell behind the clock. Runs on a timer; tests call it directly.
    func tick() {
        lock.withLock {
            guard let current = session else { return }
            let elapsed = elapsedSamples(current)
            for channel in current.channels.values where elapsed - channel.total > Self.lagLimitSamples {
                pad(elapsed - Self.lagKeepSamples - channel.total, channel, current)
            }
        }
    }

    // MARK: Internals

    private func stopSources() {
        mic.stop()
        system.stop()
    }

    private func startTimer() {
        guard let tickInterval else { return }
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "murmur.meeting.tick"))
        timer.schedule(deadline: .now() + tickInterval, repeating: tickInterval)
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume()
        lock.withLock { self.timer = timer }
    }

    private func stopTimer() {
        lock.withLock {
            timer?.cancel()
            timer = nil
        }
    }

    private func elapsedSamples(_ current: Session) -> Int {
        max(0, now() - current.startedAt) * Self.sampleRate / 1000
    }

    private func receive(_ samples: [Float], rate: Double, channel name: String, meetingId: String) {
        lock.withLock {
            guard let current = session, current.meetingId == meetingId, let channel = current.channels[name] else {
                return
            }
            if channel.resampler?.inputRate != rate { channel.resampler = try? Resampler(inputRate: rate) }
            guard let resampler = channel.resampler else { return }
            append(resampler.process(samples), to: channel, in: current)
        }
    }

    private func issue(_ code: String, channel: String, meetingId: String) {
        emit(
            Envelope(
                id: nil, type: "capture.error",
                payload: ["meetingId": .string(meetingId), "channel": .string(channel), "code": .string(code)]))
    }

    /// Called with `lock` held.
    private func pad(_ count: Int, _ channel: Channel, _ current: Session) {
        guard count > 0 else { return }
        append([Float](repeating: 0, count: count), to: channel, in: current)
    }

    /// Called with `lock` held. Splits samples over chunk files.
    private func append(_ samples: [Float], to channel: Channel, in current: Session) {
        var rest = samples[...]
        while !rest.isEmpty {
            if channel.file == nil && !channel.failed { openChunk(channel, in: current) }
            let take = min(rest.count, current.chunkSamples - channel.inChunk)
            let part = Array(rest.prefix(take))
            rest = rest.dropFirst(take)
            if let file = channel.file {
                do {
                    try file.append(part)
                } catch {
                    fail(channel, in: current, "write_failed")
                }
            }
            channel.inChunk += take
            channel.total += take
            level(part, channel, current)
            if channel.inChunk >= current.chunkSamples { finishChunk(channel, in: current) }
        }
    }

    private func level(_ samples: [Float], _ channel: Channel, _ current: Session) {
        for sample in samples {
            channel.levelSum += Double(sample * sample)
            channel.levelCount += 1
            if channel.levelCount == Self.levelSamples {
                let db = Decibels.rounded(Decibels.fromMeanSquare(channel.levelSum / Double(channel.levelCount)))
                channel.levelSum = 0
                channel.levelCount = 0
                emit(
                    Envelope(
                        id: nil, type: "capture.level",
                        payload: [
                            "meetingId": .string(current.meetingId), "channel": .string(channel.name),
                            "rmsDb": .double(db),
                        ]))
            }
        }
    }

    private func chunkURL(_ channel: Channel, in current: Session, partial: Bool) -> URL {
        let name = String(format: "%@-%06d", channel.name, channel.seq)
        return current.folder.appendingPathComponent(
            "\(name)\(partial ? ".partial" : "").\(encoder.fileExtension)")
    }

    private func openChunk(_ channel: Channel, in current: Session) {
        channel.seq += 1
        channel.inChunk = 0
        channel.chunkStart = channel.total
        let url = chunkURL(channel, in: current, partial: true)
        do {
            channel.file = try encoder.open(url: url)
            channel.fileURL = url
            try? fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch {
            fail(channel, in: current, "write_failed")
        }
    }

    private func fail(_ channel: Channel, in current: Session, _ code: String) {
        guard !channel.failed else { return }
        channel.failed = true
        channel.file?.close()
        channel.file = nil
        if let url = channel.fileURL { try? fileManager.removeItem(at: url) }
        channel.fileURL = nil
        issue(code, channel: channel.name, meetingId: current.meetingId)
    }

    /// Called with `lock` held. Closes the chunk being written and reports it.
    private func finishChunk(_ channel: Channel, in current: Session) {
        guard let file = channel.file, let partial = channel.fileURL else { return }
        file.close()
        channel.file = nil
        channel.fileURL = nil
        let final = chunkURL(channel, in: current, partial: false)
        guard channel.inChunk > 0 else {
            try? fileManager.removeItem(at: partial)
            return
        }
        do {
            try? fileManager.removeItem(at: final)
            try fileManager.moveItem(at: partial, to: final)
            let data = try Data(contentsOf: final)
            let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            channel.chunks += 1
            emit(
                Envelope(
                    id: nil, type: "capture.chunk",
                    payload: [
                        "meetingId": .string(current.meetingId), "channel": .string(channel.name),
                        "seq": .int(channel.seq), "path": .string(final.path), "sha256": .string(hash),
                        "bytes": .int(data.count),
                        "startMs": .int(channel.chunkStart * 1000 / Self.sampleRate),
                        "durationMs": .int(channel.inChunk * 1000 / Self.sampleRate),
                    ]))
        } catch {
            fail(channel, in: current, "write_failed")
        }
        channel.inChunk = 0
    }

    /// An absolute folder path with no `..` parts, or nil.
    static func folder(_ path: String) -> URL? {
        guard path.hasPrefix("/"), path.count <= 1024, !path.contains("\0"),
            !path.split(separator: "/").contains("..")
        else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }
}
