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
func writeStdout(_ data: Data) {
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

var host = HelperHost(
    router: MessageRouter(
        capabilities: ProtocolConstants.capabilities,
        permissions: SystemPermissionProvider(),
        uptimeMs: HostInfo.uptimeProvider()))
Log.info("started, helper \(ProtocolConstants.helperVersion), protocol \(ProtocolConstants.protocolVersion)")
writeStdout(host.greeting())

var chunk = [UInt8](repeating: 0, count: 64 * 1024)
while true {
    let count = read(STDIN_FILENO, &chunk, chunk.count)
    if count < 0 {
        if errno == EINTR { continue }
        Log.info("stdin read failed, exiting")
        exit(1)
    }
    if count == 0 {
        Log.info("stdin closed, exiting")
        exit(0)
    }
    let output = host.receive(Data(chunk[0..<count]))
    for message in output.messages {
        writeStdout(message)
    }
    if output.shouldExit {
        Log.info("shutdown requested, exiting")
        exit(0)
    }
}
