import Dispatch
import Foundation
import MurmurHelperCore

// A closed pipe must surface as a failed write, not kill the process.
signal(SIGPIPE, SIG_IGN)

// SIGTERM: exit cleanly with status 0.
signal(SIGTERM, SIG_IGN)
let terminationSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
terminationSource.setEventHandler {
    Log.info("received SIGTERM, exiting")
    exit(0)
}
terminationSource.resume()

/// Writes all bytes to stdout. If stdout is gone the parent is gone, so exit.
@Sendable func writeStdout(_ data: Data) {
    var offset = 0
    let total = data.count
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
        while offset < total {
            let written = write(STDOUT_FILENO, raw.baseAddress! + offset, total - offset)
            if written < 0 {
                if errno == EINTR { continue }
                Log.info("stdout closed, exiting")
                exit(0)
            }
            offset += written
        }
    }
}

// Every stdout line goes through one writer, so tap events and replies never interleave.
let output = OutputWriter(write: writeStdout)
/// `MURMUR_AUDIO_FIXTURE` names an audio file to use in place of the microphone (tests only).
let fixtureClip: URL? = {
    guard let path = ProcessInfo.processInfo.environment["MURMUR_AUDIO_FIXTURE"], !path.isEmpty else { return nil }
    return URL(fileURLWithPath: path)
}()
let permissions: any PermissionProvider = fixtureClip == nil
    ? SystemPermissionProvider()
    : FixturePermissionProvider(base: SystemPermissionProvider())
if let fixtureClip {
    Log.info("FIXTURE MODE: reading \(fixtureClip.path) instead of the microphone")
}
let hotkeys = HotkeyController(source: EventTapSource(), permissions: permissions, emit: output.send)

/// Temporary capture files. `MURMUR_AUDIO_DIR` overrides it for development and tests.
let audioDirectory: URL = {
    if let override = ProcessInfo.processInfo.environment["MURMUR_AUDIO_DIR"], !override.isEmpty {
        return URL(fileURLWithPath: override, isDirectory: true)
    }
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
    return support.appendingPathComponent("Murmur/audio/tmp", isDirectory: true)
}()
let audio = AudioCaptureController(
    source: fixtureClip.map { FileAudioSource(url: $0) as any AudioInputSource } ?? EngineAudioSource(),
    permissions: permissions, directory: audioDirectory, emit: output.send)
let speech = TranscriptionController(recognizer: WhisperKitRecognizer(), reply: output.send)
let pasteboard = SystemPasteboard()
let insertion = InsertionController(
    inserter: Inserter(
        pasteboard: pasteboard, keys: SystemKeyPoster(),
        sleep: { seconds in try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }),
    pasteboard: pasteboard, permissions: permissions, frontmostBundleId: { Frontmost.bundleId() },
    reply: output.send)
let keyPoster = SystemKeyPoster()
let selection = SelectionController(
    reading: SelectionReading(
        reader: SystemSelectionReader(), pasteboard: pasteboard, keys: keyPoster,
        sleep: { seconds in try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }),
    permissions: permissions, frontmostBundleId: { Frontmost.bundleId() }, reply: output.send)

/// Stops the key listener and writes what is pending before the process ends.
func finish(status: Int32, _ message: String) -> Never {
    Log.info(message)
    hotkeys.stop()
    audio.shutdown()
    output.flush()
    exit(status)
}

var host = HelperHost(
    router: MessageRouter(
        capabilities: ProtocolConstants.capabilities,
        permissions: permissions,
        hotkeys: hotkeys,
        audio: audio,
        speech: speech,
        insertion: insertion,
        media: MediaController(output: SystemOutputMute()),
        context: ContextController(reader: SystemFocusContextReader(), permissions: permissions, reply: output.send),
        playback: PlaybackController(control: SystemNowPlaying()),
        edits: EditWatchController(source: SystemWatchedFieldSource(), permissions: permissions, emit: output.send),
        processes: ProcessController(table: SystemProcessTable()),
        selection: selection,
        keys: KeysController(keys: keyPoster, permissions: permissions, frontmostBundleId: { Frontmost.bundleId() }),
        uptimeMs: HostInfo.uptimeProvider()))
Log.info("started, helper \(ProtocolConstants.helperVersion), protocol \(ProtocolConstants.protocolVersion)")
output.send(host.greeting())

var chunk = [UInt8](repeating: 0, count: 64 * 1024)
while true {
    let count = read(STDIN_FILENO, &chunk, chunk.count)
    if count < 0 {
        if errno == EINTR { continue }
        finish(status: 1, "stdin read failed, exiting")
    }
    if count == 0 {
        finish(status: 0, "stdin closed, exiting")
    }
    let result = host.receive(Data(chunk[0..<count]))
    for message in result.messages {
        output.send(message)
    }
    if result.shouldExit {
        finish(status: 0, "shutdown requested, exiting")
    }
}
