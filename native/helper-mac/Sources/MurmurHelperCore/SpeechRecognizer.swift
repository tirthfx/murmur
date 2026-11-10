import Foundation

/// What the recognizer returns for one piece of audio.
public struct RecognizedSegment: Sendable, Equatable {
    public var startMs: Int
    public var endMs: Int
    public var text: String
    /// 0 to 1, from the decoder's average log probability.
    public var confidence: Double

    public init(startMs: Int, endMs: Int, text: String, confidence: Double) {
        self.startMs = startMs
        self.endMs = endMs
        self.text = text
        self.confidence = confidence
    }
}

public struct Recognition: Sendable, Equatable {
    public var text: String
    public var language: String
    public var segments: [RecognizedSegment]

    public init(text: String, language: String, segments: [RecognizedSegment]) {
        self.text = text
        self.language = language
        self.segments = segments
    }
}

public struct RecognitionOptions: Sendable, Equatable {
    /// BCP-47 codes. Empty means detect; one means force that language.
    public var languages: [String]

    public init(languages: [String] = []) { self.languages = languages }
}

public struct LoadedModel: Sendable, Equatable {
    public var computeUnits: String
    public init(computeUnits: String) { self.computeUnits = computeUnits }
}

/// The speech engine seen by the controller. The real one wraps WhisperKit; tests use a fake.
/// Implementations must never reach the network: model and tokenizer come from local folders.
public protocol SpeechRecognizer: Sendable {
    func load(modelDirectory: URL, tokenizerDirectory: URL) async throws -> LoadedModel
    func unload() async
    func transcribe(_ samples: [Float], options: RecognitionOptions) async throws -> Recognition
}

public enum SpeechRecognizerError: Error, Equatable {
    case notLoaded
    case loadFailed(String)
    case decodeFailed(String)
}

enum PCMReader {
    /// Reads signed 16-bit little-endian mono PCM as floats from -1 to 1.
    static func floats(from data: Data) -> [Float] {
        let count = data.count / 2
        var samples = [Float](repeating: 0, count: count)
        data.withUnsafeBytes { raw in
            for index in 0..<count {
                let value = Int16(littleEndian: raw.loadUnaligned(fromByteOffset: index * 2, as: Int16.self))
                samples[index] = Float(value) / 32_768
            }
        }
        return samples
    }
}
