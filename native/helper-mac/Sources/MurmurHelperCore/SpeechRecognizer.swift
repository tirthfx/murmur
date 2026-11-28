@preconcurrency import AVFoundation
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

/// The language the detector found most likely among every language the model knows.
public struct LanguageGuess: Sendable, Equatable {
    public var language: String
    /// 0 to 1.
    public var confidence: Double

    public init(language: String, confidence: Double) {
        self.language = language
        self.confidence = confidence
    }
}

public struct Recognition: Sendable, Equatable {
    public var text: String
    public var language: String
    public var segments: [RecognizedSegment]
    /// Set when the language was detected (several were chosen); the one forced may differ.
    public var heard: LanguageGuess?

    public init(text: String, language: String, segments: [RecognizedSegment], heard: LanguageGuess? = nil) {
        self.text = text
        self.language = language
        self.segments = segments
        self.heard = heard
    }
}

public struct RecognitionOptions: Sendable, Equatable {
    /// BCP-47 codes. Empty means detect; one means force that language.
    public var languages: [String]
    /// Text to condition the decoder on (words already on screen); nil for none.
    public var prompt: String?
    /// Write the words in English whatever language is spoken (the model's translate task).
    /// The recognition still reports the language that was spoken.
    public var translate: Bool

    public init(languages: [String] = [], prompt: String? = nil, translate: Bool = false) {
        self.languages = languages
        self.prompt = prompt
        self.translate = translate
    }
}

/// Picks the language to force when the user chose several (DC-17, DC-19).
public enum LanguageChoice {
    /// The base code: "en-GB" becomes "en".
    public static func base(_ code: String) -> String {
        String(code.prefix(while: { $0 != "-" })).lowercased()
    }

    /// The chosen language the detector found most likely. On a tie, or when none of them
    /// was scored, the earlier one in the list wins (the first is the primary).
    public static func pick(probabilities: [String: Float], allowed: [String]) -> String? {
        let bases = allowed.map(base)
        var best: (code: String, score: Float)?
        for code in bases {
            guard let score = probabilities[code] else { continue }
            if best == nil || score > best!.score { best = (code, score) }
        }
        return best?.code ?? bases.first
    }

    /// Turns the model's raw language scores into probabilities that add up to one.
    public static func probabilities(logits: [String: Float]) -> [String: Float] {
        let finite = logits.filter { $0.value.isFinite }
        guard let top = finite.values.max() else { return [:] }
        // Subtracting the largest first keeps `exp` from overflowing.
        let weights = finite.mapValues { exp($0 - top) }
        let sum = weights.values.reduce(0, +)
        return weights.mapValues { $0 / sum }
    }

    /// The most likely language of all; the first by code on a tie.
    public static func guess(probabilities: [String: Float]) -> LanguageGuess? {
        probabilities
            .max { $0.value == $1.value ? $0.key > $1.key : $0.value < $1.value }
            .map { LanguageGuess(language: $0.key, confidence: min(max(Double($0.value), 0), 1)) }
    }
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

/// Reads a compressed audio file (a meeting's `.m4a` chunk) as 16 kHz mono floats.
enum AudioFileReader {
    static func floats(url: URL) throws -> [Float] {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        let frames = AVAudioFrameCount(file.length)
        guard frames > 0 else { return [] }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return [] }
        try file.read(into: buffer)
        guard let channels = buffer.floatChannelData else { return [] }
        let count = Int(buffer.frameLength)
        let channelCount = Int(format.channelCount)
        var mono = [Float](repeating: 0, count: count)
        for channel in 0..<channelCount {
            for index in 0..<count { mono[index] += channels[channel][index] }
        }
        if channelCount > 1 {
            let scale = 1 / Float(channelCount)
            for index in 0..<count { mono[index] *= scale }
        }
        if format.sampleRate == Double(AudioFormat.sampleRate) { return mono }
        let resampler = try Resampler(inputRate: format.sampleRate)
        return resampler.process(mono) + resampler.flush()
    }
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
