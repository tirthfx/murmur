import CoreML
import Foundation
@preconcurrency import WhisperKit

/// Speech recognition with WhisperKit, from local folders only. `download` is off and the
/// tokenizer must be on disk: WhisperKit would otherwise fetch a missing tokenizer from the
/// network, so its absence is treated as a load failure instead.
public actor WhisperKitRecognizer: SpeechRecognizer {
    private var pipe: WhisperKit?

    public init() {}

    public func load(modelDirectory: URL, tokenizerDirectory: URL) async throws -> LoadedModel {
        let fileManager = FileManager.default
        for required in ["config.json", "AudioEncoder.mlmodelc", "TextDecoder.mlmodelc", "MelSpectrogram.mlmodelc"]
        where !fileManager.fileExists(atPath: modelDirectory.appendingPathComponent(required).path) {
            throw SpeechRecognizerError.loadFailed("The model folder is missing \(required)")
        }
        guard fileManager.fileExists(atPath: tokenizerDirectory.appendingPathComponent("tokenizer.json").path) else {
            throw SpeechRecognizerError.loadFailed("The tokenizer folder is missing tokenizer.json")
        }
        pipe = nil
        let compute = ModelComputeOptions(
            melCompute: .cpuAndGPU, audioEncoderCompute: .cpuAndNeuralEngine,
            textDecoderCompute: .cpuAndNeuralEngine)
        let config = WhisperKitConfig(
            modelFolder: modelDirectory.path,
            tokenizerFolder: tokenizerDirectory,
            computeOptions: compute,
            verbose: false,
            logLevel: .error,
            prewarm: true,
            load: true,
            download: false)
        do {
            pipe = try await WhisperKit(config)
        } catch {
            throw SpeechRecognizerError.loadFailed(String(describing: error))
        }
        return LoadedModel(computeUnits: "encoder=neuralEngine decoder=neuralEngine mel=gpu")
    }

    public func unload() async {
        await pipe?.unloadModels()
        pipe = nil
    }

    public func transcribe(_ samples: [Float], options: RecognitionOptions) async throws -> Recognition {
        guard let pipe else { throw SpeechRecognizerError.notLoaded }
        var decode = DecodingOptions()
        decode.verbose = false
        decode.task = .transcribe
        if options.languages.count == 1, let language = options.languages.first {
            decode.language = LanguageChoice.base(language)
            decode.detectLanguage = false
        } else if options.languages.count > 1 {
            // Detect, but only among the chosen languages: score them, then force the best.
            var chosen = LanguageChoice.base(options.languages[0])
            if let detected = try? await pipe.detectLangauge(audioArray: samples) {
                chosen = LanguageChoice.pick(probabilities: detected.langProbs, allowed: options.languages) ?? chosen
            }
            decode.language = chosen
            decode.detectLanguage = false
        } else {
            decode.language = nil
            decode.detectLanguage = true
        }
        decode.skipSpecialTokens = true
        decode.withoutTimestamps = false
        decode.chunkingStrategy = ChunkingStrategy.none
        if let prompt = options.prompt, let tokenizer = pipe.tokenizer {
            // Words already on screen help the decoder spell names and terms. Only the last
            // 200 tokens are kept; special tokens are never passed in.
            let tokens = tokenizer.encode(text: " " + prompt.trimmingCharacters(in: .whitespacesAndNewlines))
                .filter { $0 < tokenizer.specialTokens.specialTokenBegin }
            decode.promptTokens = Array(tokens.suffix(Self.maxPromptTokens))
        }
        let results: [TranscriptionResult]
        do {
            results = try await pipe.transcribe(audioArray: samples, decodeOptions: decode)
        } catch {
            throw SpeechRecognizerError.decodeFailed(String(describing: error))
        }
        var segments: [RecognizedSegment] = []
        for result in results {
            for segment in result.segments {
                let text = Self.clean(segment.text)
                if text.isEmpty { continue }
                segments.append(
                    RecognizedSegment(
                        startMs: Int((segment.start * 1000).rounded()),
                        endMs: Int((segment.end * 1000).rounded()),
                        text: text,
                        confidence: min(max(Double(exp(segment.avgLogprob)), 0), 1)))
            }
        }
        let text = segments.map(\.text).joined(separator: " ")
        return Recognition(text: text, language: results.first?.language ?? "", segments: segments)
    }

    static let maxPromptTokens = 200

    /// Strips special tokens such as `<|startoftranscript|>` that can survive in segment text.
    static func clean(_ text: String) -> String {
        text.replacingOccurrences(of: #"<\|[^|]*\|>"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
