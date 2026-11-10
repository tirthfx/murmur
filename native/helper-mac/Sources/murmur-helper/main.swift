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
let permissions = SystemPermissionProvider()
let hotkeys = HotkeyController(source: EventTapSource(), permissions: permissions, emit: output.send)

/// Stops the key listener and writes what is pending before the process ends.
func finish(status: Int32, _ message: String) -> Never {
    Log.info(message)
    hotkeys.stop()
    output.flush()
    exit(status)
}

var host = HelperHost(
    router: MessageRouter(
        capabilities: ProtocolConstants.capabilities,
        permissions: permissions,
        hotkeys: hotkeys,
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
