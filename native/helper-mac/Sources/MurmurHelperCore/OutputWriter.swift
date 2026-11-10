import Foundation

/// Serialises everything written to stdout. Replies come from the stdin loop and events
/// from other threads (the hotkey tap); one serial queue keeps lines whole and in order,
/// and keeps the tap thread from blocking on a slow pipe.
public final class OutputWriter: Sendable {
    private let queue = DispatchQueue(label: "murmur-helper.stdout")
    private let write: @Sendable (Data) -> Void

    /// `write` must write all bytes. It runs on the writer's queue.
    public init(write: @escaping @Sendable (Data) -> Void) {
        self.write = write
    }

    public func send(_ data: Data) {
        queue.async { [write] in write(data) }
    }

    public func send(_ envelope: Envelope) {
        send(EnvelopeCodec.encode(envelope))
    }

    /// Waits until everything sent so far has been written.
    public func flush() {
        queue.sync {}
    }
}
