import Foundation
import XCTest

@testable import MurmurHelperCore

/// Stands in for WhisperKit. Delays let tests hold a load or decode open.
actor FakeRecognizer: SpeechRecognizer {
    var loadDelay: Double = 0
    var decodeDelay: Double = 0
    var loadError: SpeechRecognizerError?
    var decodeError: SpeechRecognizerError?
    private(set) var loads: [(URL, URL)] = []
    private(set) var decodes: [(count: Int, options: RecognitionOptions)] = []

    func configure(loadDelay: Double = 0, decodeDelay: Double = 0, loadError: SpeechRecognizerError? = nil,
                   decodeError: SpeechRecognizerError? = nil) {
        self.loadDelay = loadDelay
        self.decodeDelay = decodeDelay
        self.loadError = loadError
        self.decodeError = decodeError
    }

    func load(modelDirectory: URL, tokenizerDirectory: URL) async throws -> LoadedModel {
        loads.append((modelDirectory, tokenizerDirectory))
        if loadDelay > 0 { try? await Task.sleep(nanoseconds: UInt64(loadDelay * 1e9)) }
        if let loadError { throw loadError }
        return LoadedModel(computeUnits: "test")
    }

    func unload() async {}

    func transcribe(_ samples: [Float], options: RecognitionOptions) async throws -> Recognition {
        decodes.append((samples.count, options))
        if decodeDelay > 0 { try? await Task.sleep(nanoseconds: UInt64(decodeDelay * 1e9)) }
        if let decodeError { throw decodeError }
        return Recognition(
            text: "Hello there.", language: options.languages.first ?? "en",
            segments: [RecognizedSegment(startMs: 0, endMs: 1200, text: "Hello there.", confidence: 0.91234)])
    }
}

/// Polls until `count` replies have arrived or two seconds pass.
func waitForReplies(_ events: EmittedEvents, count: Int, file: StaticString = #filePath, line: UInt = #line) {
    let deadline = Date().addingTimeInterval(2)
    while events.all.count < count && Date() < deadline { Thread.sleep(forTimeInterval: 0.005) }
    XCTAssertGreaterThanOrEqual(events.all.count, count, "waited for \(count) replies", file: file, line: line)
}

final class TranscriptionControllerTests: XCTestCase {
    private var directory: URL!

    override func setUp() {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("murmur-speech-tests-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    override func tearDown() { try? FileManager.default.removeItem(at: directory) }

    private func make(timeoutPerWindow: Double = 20) -> (TranscriptionController, FakeRecognizer, EmittedEvents) {
        let recognizer = FakeRecognizer()
        let events = EmittedEvents()
        let controller = TranscriptionController(
            recognizer: recognizer, reply: { events.append($0) }, timeoutPerWindow: timeoutPerWindow)
        return (controller, recognizer, events)
    }

    private let loadPayload: [String: JSONValue] = [
        "model": .string("whisper-test"), "modelDir": .string("/models/test/model"),
        "tokenizerDir": .string("/models/test/tokenizer"),
    ]

    private func pcmFile(seconds: Double, name: String = "clip.pcm") throws -> String {
        let url = directory.appendingPathComponent(name)
        try AudioPipeline.pcm16(Signal.sine(seconds: seconds, rate: 16_000, amplitude: 0.2)).write(to: url)
        return url.path
    }

    private func loaded() -> (TranscriptionController, FakeRecognizer, EmittedEvents) {
        let (controller, recognizer, events) = make()
        XCTAssertNil(controller.handle(id: "m-1", type: "transcribe.load", payload: loadPayload))
        waitForReplies(events, count: 1)
        events.clear()
        return (controller, recognizer, events)
    }

    func testLoadRepliesLaterWithTheModelName() async throws {
        let (controller, recognizer, events) = make()
        XCTAssertNil(controller.handle(id: "m-1", type: "transcribe.load", payload: loadPayload))
        waitForReplies(events, count: 1)
        let reply = try XCTUnwrap(events.all.first)
        XCTAssertEqual(reply.id, "m-1")
        XCTAssertEqual(reply.payload["ok"], .bool(true))
        let result = try XCTUnwrap(reply.payload["result"]?.objectValue)
        XCTAssertEqual(result["loadedModel"], .string("whisper-test"))
        XCTAssertNotNil(result["loadMs"]?.intValue)
        XCTAssertEqual(controller.currentModel, "whisper-test")
        let loads = await recognizer.loads
        XCTAssertEqual(loads.first?.1.path, "/models/test/tokenizer")
    }

    func testLoadNeedsAbsoluteFolders() {
        let (controller, _, _) = make()
        var payload = loadPayload
        payload["tokenizerDir"] = .string("relative/tokenizer")
        let reply = controller.handle(id: "m-1", type: "transcribe.load", payload: payload)
        XCTAssertEqual(reply.flatMap(errorCode), "INVALID_PAYLOAD")
    }

    func testLoadFailureIsModelLoadFailed() async {
        let (controller, recognizer, events) = make()
        await recognizer.configure(loadError: .loadFailed("The tokenizer folder is missing tokenizer.json"))
        XCTAssertNil(controller.handle(id: "m-1", type: "transcribe.load", payload: loadPayload))
        waitForReplies(events, count: 1)
        XCTAssertEqual(events.all.first.flatMap(errorCode), "MODEL_LOAD_FAILED")
        XCTAssertNil(controller.currentModel)
    }

    func testTranscribeBeforeLoadIsModelNotLoaded() throws {
        let (controller, _, _) = make()
        let reply = controller.handle(id: "m-2", type: "transcribe.file", payload: ["path": .string(try pcmFile(seconds: 1))])
        XCTAssertEqual(reply.flatMap(errorCode), "MODEL_NOT_LOADED")
    }

    func testTranscribeFileRepliesWithTextSegmentsAndTimes() async throws {
        let (controller, recognizer, events) = loaded()
        let path = try pcmFile(seconds: 2)
        XCTAssertNil(
            controller.handle(
                id: "m-2", type: "transcribe.file",
                payload: ["path": .string(path), "languages": .array([.string("de")])]))
        waitForReplies(events, count: 1)
        let result = try XCTUnwrap(events.all.first?.payload["result"]?.objectValue)
        XCTAssertEqual(result["text"], .string("Hello there."))
        XCTAssertEqual(result["language"], .string("de"))
        XCTAssertEqual(result["audioMs"], .int(2_000))
        XCTAssertNotNil(result["decodeMs"]?.intValue)
        XCTAssertEqual(
            result["segments"],
            .array([
                .object([
                    "startMs": .int(0), "endMs": .int(1200), "text": .string("Hello there."),
                    "confidence": .double(0.912),
                ])
            ]))
        let decodes = await recognizer.decodes
        XCTAssertEqual(decodes.first?.count, 32_000)
        XCTAssertEqual(decodes.first?.options.languages, ["de"])
        XCTAssertNil(decodes.first?.options.prompt)
    }

    func testPassesThePromptAndRefusesAnOversizedOne() async throws {
        let (controller, recognizer, events) = loaded()
        let path = try pcmFile(seconds: 1)
        XCTAssertNil(
            controller.handle(
                id: "m-2", type: "transcribe.file",
                payload: ["path": .string(path), "languages": .array([]), "prompt": .string("Hi Priya Raghunathan")]))
        waitForReplies(events, count: 1)
        let decodes = await recognizer.decodes
        XCTAssertEqual(decodes.first?.options.prompt, "Hi Priya Raghunathan")
        let refused = controller.handle(
            id: "m-3", type: "transcribe.file",
            payload: ["path": .string(path), "prompt": .string(String(repeating: "x", count: 2_001))])
        XCTAssertEqual(refused.flatMap(errorCode), "INVALID_PAYLOAD")
    }

    func testBackToBackTranscriptionsAreNotBusy() throws {
        let (controller, _, events) = loaded()
        let path = try pcmFile(seconds: 1)
        for index in 0..<3 {
            XCTAssertNil(controller.handle(id: "m-\(index)", type: "transcribe.file", payload: ["path": .string(path)]))
            waitForReplies(events, count: index + 1)
        }
        XCTAssertEqual(events.all.map { $0.payload["ok"] }, [.bool(true), .bool(true), .bool(true)])
    }

    func testOneThingAtATime() async throws {
        let (controller, recognizer, events) = make()
        await recognizer.configure(loadDelay: 0.3)
        XCTAssertNil(controller.handle(id: "m-1", type: "transcribe.load", payload: loadPayload))
        let second = controller.handle(id: "m-2", type: "transcribe.load", payload: loadPayload)
        XCTAssertEqual(second.flatMap(errorCode), "BUSY")
        XCTAssertEqual(second?.payload["error"]?.objectValue?["retryable"], .bool(true))
        waitForReplies(events, count: 1)
    }

    func testSlowDecodeTimesOut() async throws {
        let (controller, recognizer, events) = make(timeoutPerWindow: 0.05)
        XCTAssertNil(controller.handle(id: "m-1", type: "transcribe.load", payload: loadPayload))
        waitForReplies(events, count: 1)
        events.clear()
        await recognizer.configure(decodeDelay: 0.4)
        XCTAssertNil(controller.handle(id: "m-2", type: "transcribe.file", payload: ["path": .string(try pcmFile(seconds: 1))]))
        waitForReplies(events, count: 1)
        XCTAssertEqual(events.all.first.flatMap(errorCode), "TRANSCRIPTION_TIMEOUT")
        // The decoder is still busy until it really returns.
        let busy = controller.handle(id: "m-3", type: "transcribe.file", payload: ["path": .string(try pcmFile(seconds: 1))])
        XCTAssertEqual(busy.flatMap(errorCode), "BUSY")
    }

    func testDecodeErrorIsTranscriptionFailed() async throws {
        let (controller, recognizer, events) = loaded()
        await recognizer.configure(decodeError: .decodeFailed("bad"))
        XCTAssertNil(controller.handle(id: "m-2", type: "transcribe.file", payload: ["path": .string(try pcmFile(seconds: 1))]))
        waitForReplies(events, count: 1)
        XCTAssertEqual(events.all.first.flatMap(errorCode), "TRANSCRIPTION_FAILED")
    }

    func testBadPathsAreRefusedAtOnce() {
        let (controller, _, _) = loaded()
        for path in ["relative.pcm", "/etc/passwd", "/no/such/file.pcm"] {
            let reply = controller.handle(id: "m-2", type: "transcribe.file", payload: ["path": .string(path)])
            XCTAssertNotNil(reply, path)
        }
        XCTAssertEqual(
            controller.handle(id: "m-2", type: "transcribe.file", payload: ["path": .string("/no/such/file.pcm")])
                .flatMap(errorCode), "NOT_FOUND")
    }

    func testEmptyAudioGivesEmptyText() throws {
        let (controller, _, events) = loaded()
        let url = directory.appendingPathComponent("empty.pcm")
        try Data().write(to: url)
        XCTAssertNil(controller.handle(id: "m-2", type: "transcribe.file", payload: ["path": .string(url.path)]))
        waitForReplies(events, count: 1)
        XCTAssertEqual(events.all.first?.payload["result"]?.objectValue?["text"], .string(""))
    }

    func testRouterAnswersLaterAndStaysResponsive() throws {
        let events = EmittedEvents()
        let speech = TranscriptionController(recognizer: FakeRecognizer(), reply: { events.append($0) })
        var router = MessageRouter(permissions: FakePermissionProvider(), speech: speech, uptimeMs: { 7 })
        _ = router.handle(line: line(validAck))
        let immediate = router.handle(
            line: line(
                #"{"id":"m-000040","type":"transcribe.load","payload":{"model":"m","modelDir":"/a/model","tokenizerDir":"/a/tokenizer"}}"#))
        XCTAssertEqual(immediate, [])
        let ping = router.handle(line: line(#"{"id":"m-000041","type":"ping","payload":{}}"#))
        XCTAssertEqual(ping.first?.payload["ok"], .bool(true))
        waitForReplies(events, count: 1)
        XCTAssertEqual(events.all.first?.id, "m-000040")
        XCTAssertEqual(events.all.first?.payload["requestType"], .string("transcribe.load"))
    }

    func testCleanRemovesSpecialTokens() {
        XCTAssertEqual(WhisperKitRecognizer.clean("<|startoftranscript|><|en|> Hello.<|endoftext|>"), "Hello.")
    }

    func testPCMReaderScalesSixteenBitSamples() {
        var data = Data()
        for value: Int16 in [0, 16_384, -32_768] { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        XCTAssertEqual(PCMReader.floats(from: data), [0, 0.5, -1])
    }
}
