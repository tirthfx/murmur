@preconcurrency import AVFoundation
import Foundation

/// Signal processing for microphone capture. Nothing here touches a device, so every rule
/// is covered by unit tests with generated audio.

public enum AudioFormat {
    /// Capture output: 16 kHz mono, written as signed 16-bit little-endian PCM.
    public static let sampleRate = 16_000
    public static let channels = 1
    public static let codec = "pcm_s16le"
}

public enum Decibels {
    /// Floor for silence, so zero never becomes minus infinity.
    public static let floor = -120.0

    public static func fromAmplitude(_ value: Double) -> Double {
        value <= 0 ? floor : max(floor, 20 * log10(value))
    }

    public static func fromMeanSquare(_ value: Double) -> Double {
        value <= 0 ? floor : max(floor, 10 * log10(value))
    }

    public static func toAmplitude(_ db: Double) -> Double { pow(10, db / 20) }

    /// One decimal place, for the protocol.
    public static func rounded(_ db: Double) -> Double { (db * 10).rounded() / 10 }
}

/// Settings for one capture session. The gain rule is provisional (vault ADR on #7): it is
/// tuned later with quiet-speech recordings.
public struct AudioPipelineSettings: Sendable, Equatable {
    /// Speech below this level is raised towards it.
    public var gainTargetDb = -40.0
    /// Most gain ever applied.
    public var maxGainDb = 24.0
    /// Blocks quieter than this are treated as background, not speech, so noise is not boosted.
    public var speechGateDb = -55.0
    /// Peak ceiling after the limiter, a little under -1 dBFS.
    public var limiterCeilingDb = -1.1
    /// Silent-microphone check: threshold and window from the start of the session.
    public var silenceThresholdDb = -55.0
    public var silenceWindowMs = 3_000
    /// 0 turns level events off.
    public var levelIntervalMs = 100

    public init() {}
}

/// What the pipeline asks the caller to send to main.
public enum AudioPipelineEvent: Equatable, Sendable {
    case level(rmsDb: Double, peakDb: Double)
    case silent(elapsedMs: Int)
}

/// Gain, limiter, level meter, silent check and statistics, applied to 16 kHz mono floats.
/// Works in 10 ms blocks so its decisions do not depend on how input is chunked.
public struct AudioPipeline: Sendable {
    public static let blockSize = AudioFormat.sampleRate / 100
    static let samplesPer100ms = AudioFormat.sampleRate / 10
    /// How fast gain may change, per 10 ms block.
    static let gainStepDb = 0.5
    /// Smoothing of the speech level estimate per speech block.
    static let speechSmoothing = 0.1
    /// Limiter release per sample (about 50 ms to recover).
    static let limiterRelease = Float(exp(-1.0 / (0.05 * Double(AudioFormat.sampleRate))))

    public let settings: AudioPipelineSettings
    private let ceiling: Float
    private var pending: [Float] = []

    private var speechLevelDb: Double?
    public private(set) var gainDb = 0.0
    private var limiterEnvelope: Float = 0

    // Level events.
    private var levelSamples = 0
    private var levelSquares = 0.0
    private var levelPeak: Float = 0

    // Silent check on the input before gain, in 100 ms windows.
    private var windowSamples = 0
    private var windowSquares = 0.0
    /// Input above the threshold anywhere in the session.
    public private(set) var heardInput = false
    private var silentChecked = false

    // Whole-session statistics on the output.
    public private(set) var totalSamples = 0
    private var totalSquares = 0.0
    private var totalPeak: Float = 0

    public init(settings: AudioPipelineSettings = AudioPipelineSettings()) {
        self.settings = settings
        ceiling = Float(Decibels.toAmplitude(settings.limiterCeilingDb))
    }

    public var peakDb: Double { Decibels.fromAmplitude(Double(totalPeak)) }
    public var meanDb: Double {
        totalSamples == 0 ? Decibels.floor : Decibels.fromMeanSquare(totalSquares / Double(totalSamples))
    }
    public var durationMs: Int { totalSamples * 1000 / AudioFormat.sampleRate }

    /// Processes input and returns the output samples plus events to send.
    public mutating func process(_ input: [Float]) -> (output: [Float], events: [AudioPipelineEvent]) {
        pending.append(contentsOf: input)
        var output: [Float] = []
        var events: [AudioPipelineEvent] = []
        let whole = pending.count / Self.blockSize * Self.blockSize
        var start = 0
        while start < whole {
            processBlock(pending[start..<(start + Self.blockSize)], into: &output, events: &events)
            start += Self.blockSize
        }
        pending.removeFirst(whole)
        return (output, events)
    }

    /// Processes what is left (less than one block) at the end of a session.
    public mutating func finish() -> (output: [Float], events: [AudioPipelineEvent]) {
        var output: [Float] = []
        var events: [AudioPipelineEvent] = []
        if !pending.isEmpty { processBlock(pending[...], into: &output, events: &events) }
        pending.removeAll()
        return (output, events)
    }

    private mutating func processBlock(
        _ block: ArraySlice<Float>, into output: inout [Float], events: inout [AudioPipelineEvent]
    ) {
        var squares = 0.0
        for sample in block { squares += Double(sample) * Double(sample) }
        let blockDb = Decibels.fromMeanSquare(squares / Double(block.count))

        // Gain follows the speech level; background blocks leave it where it is.
        if blockDb > settings.speechGateDb {
            if let level = speechLevelDb {
                speechLevelDb = level + Self.speechSmoothing * (blockDb - level)
            } else {
                speechLevelDb = blockDb
            }
        }
        let desired = speechLevelDb.map { min(max(settings.gainTargetDb - $0, 0), settings.maxGainDb) } ?? 0
        let previousGain = gainDb
        gainDb += min(max(desired - gainDb, -Self.gainStepDb), Self.gainStepDb)

        let startAmp = Float(Decibels.toAmplitude(previousGain))
        let endAmp = Float(Decibels.toAmplitude(gainDb))
        let count = Float(block.count)
        for (offset, sample) in block.enumerated() {
            let gain = startAmp + (endAmp - startAmp) * Float(offset + 1) / count
            var value = sample * gain
            // Instant attack, smooth release: the output never exceeds the ceiling.
            limiterEnvelope = max(abs(value), limiterEnvelope * Self.limiterRelease)
            if limiterEnvelope > ceiling { value *= ceiling / limiterEnvelope }
            output.append(value)

            let square = Double(value) * Double(value)
            totalSquares += square
            totalPeak = max(totalPeak, abs(value))
            levelSquares += square
            levelPeak = max(levelPeak, abs(value))
        }
        totalSamples += block.count
        levelSamples += block.count

        if settings.levelIntervalMs > 0, levelSamples >= settings.levelIntervalMs * AudioFormat.sampleRate / 1000 {
            events.append(
                .level(
                    rmsDb: Decibels.rounded(Decibels.fromMeanSquare(levelSquares / Double(levelSamples))),
                    peakDb: Decibels.rounded(Decibels.fromAmplitude(Double(levelPeak)))))
            levelSamples = 0
            levelSquares = 0
            levelPeak = 0
        }

        // Silent check uses the input level, before gain.
        windowSamples += block.count
        windowSquares += squares
        if windowSamples >= Self.samplesPer100ms {
            if Decibels.fromMeanSquare(windowSquares / Double(windowSamples)) > settings.silenceThresholdDb {
                heardInput = true
            }
            windowSamples = 0
            windowSquares = 0
        }
        // Checked once, when the window from the start has passed.
        if !silentChecked, totalSamples >= settings.silenceWindowMs * AudioFormat.sampleRate / 1000 {
            silentChecked = true
            if !heardInput { events.append(.silent(elapsedMs: settings.silenceWindowMs)) }
        }
    }

    /// Converts to signed 16-bit little-endian bytes.
    public static func pcm16(_ samples: [Float]) -> Data {
        var data = Data(capacity: samples.count * 2)
        for sample in samples {
            let clamped = min(max(sample, -1), 1)
            let value = Int16((clamped * Float(Int16.max)).rounded())
            withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
        }
        return data
    }
}

/// Converts mono float audio at any rate to 16 kHz with AVAudioConverter, keeping filter
/// state between calls so chunk edges leave no clicks.
public final class Resampler {
    public let inputRate: Double
    private let converter: AVAudioConverter?
    private let inputFormat: AVAudioFormat
    private let outputFormat: AVAudioFormat

    public enum Failure: Error { case unsupportedRate(Double) }

    public init(inputRate: Double) throws {
        guard inputRate >= 8_000, inputRate <= 384_000,
            let input = AVAudioFormat(standardFormatWithSampleRate: inputRate, channels: 1),
            let output = AVAudioFormat(
                standardFormatWithSampleRate: Double(AudioFormat.sampleRate), channels: 1)
        else { throw Failure.unsupportedRate(inputRate) }
        self.inputRate = inputRate
        inputFormat = input
        outputFormat = output
        if inputRate == Double(AudioFormat.sampleRate) {
            converter = nil
        } else {
            guard let converter = AVAudioConverter(from: input, to: output) else {
                throw Failure.unsupportedRate(inputRate)
            }
            converter.sampleRateConverterQuality = AVAudioQuality.high.rawValue
            self.converter = converter
        }
    }

    public func process(_ samples: [Float]) -> [Float] {
        guard let converter else { return samples }
        guard !samples.isEmpty,
            let buffer = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: AVAudioFrameCount(samples.count))
        else { return [] }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            buffer.floatChannelData![0].update(from: source.baseAddress!, count: samples.count)
        }
        return convert(converter, input: buffer, endOfStream: false)
    }

    /// Returns the samples still inside the converter at the end of a session.
    public func flush() -> [Float] {
        guard let converter else { return [] }
        return convert(converter, input: nil, endOfStream: true)
    }

    private func convert(_ converter: AVAudioConverter, input: AVAudioPCMBuffer?, endOfStream: Bool) -> [Float] {
        let inputFrames = Double(input?.frameLength ?? 0)
        let capacity = AVAudioFrameCount(inputFrames * Double(AudioFormat.sampleRate) / inputRate) + 1024
        var result: [Float] = []
        var supplied = false
        while true {
            guard let out = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { break }
            var error: NSError?
            let status = converter.convert(to: out, error: &error) { _, inputStatus in
                if supplied || input == nil {
                    inputStatus.pointee = endOfStream ? .endOfStream : .noDataNow
                    return nil
                }
                supplied = true
                inputStatus.pointee = .haveData
                return input
            }
            if out.frameLength > 0, let data = out.floatChannelData?[0] {
                result.append(contentsOf: UnsafeBufferPointer(start: data, count: Int(out.frameLength)))
            }
            // Keep draining only while the converter fills whole buffers.
            if status == .error || status == .endOfStream || status == .inputRanDry || out.frameLength < capacity {
                break
            }
        }
        return result
    }
}
