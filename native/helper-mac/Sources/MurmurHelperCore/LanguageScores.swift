import CoreML
import Foundation
@preconcurrency import WhisperKit

/// How likely each language is for a piece of audio (DC-17). WhisperKit's own detection
/// reports only the winner, which cannot say which of the chosen languages is nearest, so
/// this runs the same single decoding step and reads the score of every language.
enum LanguageScores {
    /// Probabilities by language code, over every language the model knows.
    static func read(_ pipe: WhisperKit, samples: [Float]) async throws -> [String: Float] {
        guard let tokenizer = pipe.tokenizer, pipe.textDecoder.isModelMultilingual else { return [:] }
        var codes: [Int: String] = [:]
        for code in Set(Constants.languages.values) {
            if let token = tokenizer.convertTokenToId("<|\(code)|>"), tokenizer.allLanguageTokens.contains(token) {
                codes[token] = code
            }
        }
        // The first 30 seconds are enough, and all the model takes at once.
        let window = pipe.featureExtractor.windowSamples ?? Constants.defaultWindowSamples
        guard !codes.isEmpty,
            let audio = pipe.audioProcessor.padOrTrim(fromArray: samples, startAt: 0, toLength: window),
            let mel = try await pipe.featureExtractor.logMelSpectrogram(fromAudio: audio),
            let encoded = try await pipe.audioEncoder.encodeFeatures(mel)
        else { return [:] }
        let sampler = ScoreSampler(tokens: Array(codes.keys))
        let inputs = try pipe.textDecoder.prepareDecoderInputs(
            withPrompt: [tokenizer.specialTokens.startOfTranscriptToken])
        _ = try await pipe.textDecoder.detectLanguage(
            from: encoded, using: inputs, sampler: sampler, options: DecodingOptions(), temperature: 0)
        var logits: [String: Float] = [:]
        for (token, score) in sampler.scores {
            if let code = codes[token] { logits[code] = score }
        }
        return LanguageChoice.probabilities(logits: logits)
    }
}

/// Keeps the raw score of each wanted token, then answers with the best one as a sampler
/// should. Used for one decoding step on one task, so it needs no locking.
private final class ScoreSampler: TokenSampling, @unchecked Sendable {
    private let wanted: [Int]
    private(set) var scores: [Int: Float] = [:]

    init(tokens: [Int]) { wanted = tokens }

    func update(tokens: [Int], logits: MLMultiArray, logProbs: [Float]) async -> SamplingResult {
        for token in wanted where token < logits.count {
            scores[token] = logits[[0, 0, NSNumber(value: token)]].floatValue
        }
        let best = scores.max { $0.value < $1.value }?.key ?? wanted[0]
        return SamplingResult(tokens: tokens + [best], logProbs: logProbs + [0], completed: true)
    }

    func finalize(tokens: [Int], logProbs: [Float]) -> SamplingResult {
        SamplingResult(tokens: tokens, logProbs: logProbs, completed: true)
    }
}
