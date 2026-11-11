import Foundation

/// `transcribe.load`, `transcribe.unload` and `transcribe.file`. Loading a model can take
/// minutes and decoding takes seconds, so these requests are answered later through `reply`
/// while the stdin loop keeps serving pings. Bad input is answered at once.
public final class TranscriptionController: @unchecked Sendable {
    // @unchecked: every mutable field is read and written only while `lock` is held.
    private let lock = NSLock()
    private var loadedModel: String?
    private var loading = false
    private var decoding = false

    private let recognizer: any SpeechRecognizer
    private let reply: @Sendable (Envelope) -> Void
    private let clock: @Sendable () -> Double
    /// Decode time allowed per started 30 seconds of audio (issue #8: 20 s per segment).
    let timeoutPerWindow: Double

    public init(
        recognizer: any SpeechRecognizer,
        reply: @escaping @Sendable (Envelope) -> Void,
        timeoutPerWindow: Double = 20,
        clock: @escaping @Sendable () -> Double = { CFAbsoluteTimeGetCurrent() }
    ) {
        self.recognizer = recognizer
        self.reply = reply
        self.timeoutPerWindow = timeoutPerWindow
        self.clock = clock
    }

    public var currentModel: String? { lock.withLock { loadedModel } }

    /// Returns an immediate reply, or nil when the reply will come later through `reply`.
    public func handle(id: String, type: String, payload: [String: JSONValue]) -> Envelope? {
        switch type {
        case "transcribe.load": return load(id: id, payload: payload)
        case "transcribe.unload": return unload(id: id)
        case "transcribe.file": return transcribeFile(id: id, payload: payload)
        default:
            return MessageRouter.failure(id: id, requestType: type, .unsupportedRequest, "Unknown request type")
        }
    }

    // MARK: Load

    private func load(id: String, payload: [String: JSONValue]) -> Envelope? {
        let type = "transcribe.load"
        guard let model = payload["model"]?.stringValue, !model.isEmpty,
            let modelDir = Self.directory(payload["modelDir"]),
            let tokenizerDir = Self.directory(payload["tokenizerDir"])
        else {
            return MessageRouter.failure(
                id: id, requestType: type, .invalidPayload,
                "transcribe.load needs model, and modelDir and tokenizerDir as absolute paths")
        }
        let busy = lock.withLock { () -> Bool in
            if loading || decoding { return true }
            loading = true
            loadedModel = nil
            return false
        }
        if busy {
            return MessageRouter.failure(id: id, requestType: type, .busy, "A model load or transcription is running")
        }
        Log.info("loading speech model \(model)")
        let started = clock()
        Task {
            let envelope: Envelope
            do {
                let loaded = try await recognizer.load(modelDirectory: modelDir, tokenizerDirectory: tokenizerDir)
                let loadMs = Int(((clock() - started) * 1000).rounded())
                lock.withLock {
                    loading = false
                    loadedModel = model
                }
                Log.info("speech model loaded in \(loadMs) ms")
                envelope = MessageRouter.success(
                    id: id, requestType: type,
                    [
                        "loadedModel": .string(model), "loadMs": .int(loadMs),
                        "computeUnits": .string(loaded.computeUnits),
                    ])
            } catch {
                lock.withLock { loading = false }
                envelope = MessageRouter.failure(
                    id: id, requestType: type, .modelLoadFailed, "The speech model could not be loaded: \(Self.describe(error))")
            }
            reply(envelope)
        }
        return nil
    }

    private func unload(id: String) -> Envelope? {
        let type = "transcribe.unload"
        let busy = lock.withLock { () -> Bool in
            if loading || decoding { return true }
            loadedModel = nil
            return false
        }
        if busy {
            return MessageRouter.failure(id: id, requestType: type, .busy, "A model load or transcription is running")
        }
        Task {
            await recognizer.unload()
            reply(MessageRouter.success(id: id, requestType: type, [:]))
        }
        return nil
    }

    // MARK: Transcribe

    private func transcribeFile(id: String, payload: [String: JSONValue]) -> Envelope? {
        let type = "transcribe.file"
        guard let path = payload["path"]?.stringValue, path.hasPrefix("/"), path.hasSuffix(".pcm") else {
            return MessageRouter.failure(
                id: id, requestType: type, .invalidPayload, "path must be an absolute path to a .pcm file")
        }
        var languages: [String] = []
        if let value = payload["languages"] {
            guard case .array(let items) = value, items.count <= 20,
                let names = Optional(items.compactMap(\.stringValue)), names.count == items.count
            else {
                return MessageRouter.failure(id: id, requestType: type, .invalidPayload, "languages must be a list of codes")
            }
            languages = names
        }
        var prompt: String?
        if let value = payload["prompt"], value != .null {
            guard let text = value.stringValue, text.utf16.count <= 2_000 else {
                return MessageRouter.failure(
                    id: id, requestType: type, .invalidPayload, "prompt must be text of at most 2000 characters")
            }
            prompt = text.isEmpty ? nil : text
        }
        let data: Data
        do {
            data = try Data(contentsOf: URL(fileURLWithPath: path))
        } catch {
            return MessageRouter.failure(id: id, requestType: type, .notFound, "The audio file could not be read")
        }
        let state = lock.withLock { () -> String? in
            if loadedModel == nil { return "not-loaded" }
            if loading || decoding { return "busy" }
            decoding = true
            return nil
        }
        if state == "not-loaded" {
            return MessageRouter.failure(id: id, requestType: type, .modelNotLoaded, "Load a speech model first")
        }
        if state == "busy" {
            return MessageRouter.failure(id: id, requestType: type, .busy, "A model load or transcription is running")
        }

        let samples = PCMReader.floats(from: data)
        let audioMs = samples.count * 1000 / AudioFormat.sampleRate
        let windows = max(1, Int((Double(audioMs) / 30_000).rounded(.up)))
        let timeout = timeoutPerWindow * Double(windows)
        let options = RecognitionOptions(languages: languages, prompt: prompt)
        let recognizer = self.recognizer
        let started = clock()
        Task {
            let envelope: Envelope
            do {
                let recognition: Recognition
                if samples.isEmpty {
                    lock.withLock { decoding = false }
                    recognition = Recognition(text: "", language: languages.first ?? "", segments: [])
                } else {
                    let speech = SilenceTrim.trim(samples)
                    recognition = try await withTimeout(seconds: timeout) {
                        try await recognizer.transcribe(speech, options: options)
                    }
                }
                let decodeMs = Int(((clock() - started) * 1000).rounded())
                envelope = MessageRouter.success(
                    id: id, requestType: type,
                    [
                        "text": .string(recognition.text),
                        "language": .string(recognition.language),
                        "segments": .array(
                            recognition.segments.map {
                                .object([
                                    "startMs": .int($0.startMs), "endMs": .int($0.endMs), "text": .string($0.text),
                                    "confidence": .double((($0.confidence * 1000).rounded()) / 1000),
                                ])
                            }),
                        "decodeMs": .int(decodeMs),
                        "audioMs": .int(audioMs),
                    ])
                Log.info("transcribed \(audioMs) ms of audio in \(decodeMs) ms")
            } catch is TimeoutError {
                envelope = MessageRouter.failure(
                    id: id, requestType: type, .transcriptionTimeout,
                    "Transcription took longer than \(Int(timeout)) seconds")
            } catch {
                envelope = MessageRouter.failure(
                    id: id, requestType: type, .transcriptionFailed, "Transcription failed: \(Self.describe(error))")
            }
            // A timed-out decode may still be running; it holds `decoding` until it ends.
            reply(envelope)
        }
        return nil
    }

    struct TimeoutError: Error {}

    /// Runs `work`, or throws `TimeoutError` after `seconds`. When the time runs out the reply
    /// is sent at once and `decoding` stays set until the decoder actually returns.
    private func withTimeout<T: Sendable>(seconds: Double, _ work: @escaping @Sendable () async throws -> T) async throws -> T {
        try await Self.withTimeout(seconds: seconds, work, finished: { [weak self] in
            guard let self else { return }
            self.lock.withLock { self.decoding = false }
        })
    }

    private static func withTimeout<T: Sendable>(
        seconds: Double, _ work: @escaping @Sendable () async throws -> T, finished: @escaping @Sendable () -> Void
    ) async throws -> T {
        let box = ResultBox<T>()
        return try await withCheckedThrowingContinuation { continuation in
            box.set(continuation)
            Task {
                // `finished` runs before the reply, so a request sent right after the reply
                // never sees a stale busy state.
                do {
                    let value = try await work()
                    finished()
                    box.resume(.success(value))
                } catch {
                    finished()
                    box.resume(.failure(error))
                }
            }
            Task {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                box.resume(.failure(TimeoutError()))
            }
        }
    }

    /// Resumes a continuation once, whichever of decode and timer finishes first.
    private final class ResultBox<T: Sendable>: @unchecked Sendable {
        private let lock = NSLock()
        private var continuation: CheckedContinuation<T, any Error>?
        func set(_ continuation: CheckedContinuation<T, any Error>) { lock.withLock { self.continuation = continuation } }
        func resume(_ result: Result<T, any Error>) {
            let pending = lock.withLock { () -> CheckedContinuation<T, any Error>? in
                defer { continuation = nil }
                return continuation
            }
            pending?.resume(with: result)
        }
    }

    // MARK: Helpers

    private static func directory(_ value: JSONValue?) -> URL? {
        guard let path = value?.stringValue, path.hasPrefix("/") else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    private static func describe(_ error: any Error) -> String {
        switch error {
        case SpeechRecognizerError.loadFailed(let text), SpeechRecognizerError.decodeFailed(let text): return text
        case SpeechRecognizerError.notLoaded: return "no model is loaded"
        default: return String(describing: error)
        }
    }
}
