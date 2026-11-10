import Foundation

/// Glue between raw stdin bytes and the router: framing in, encoding out.
public struct HelperHost: Sendable {
    public struct Output: Sendable, Equatable {
        public var messages: [Data]
        public var shouldExit: Bool
    }

    private var router: MessageRouter
    private var lines: LineBuffer

    public init(router: MessageRouter, lines: LineBuffer = LineBuffer()) {
        self.router = router
        self.lines = lines
    }

    /// The bytes to write at startup: the `hello` event.
    public func greeting() -> Data {
        EnvelopeCodec.encode(router.helloEvent())
    }

    /// Feeds a chunk read from stdin and returns the lines to write to stdout.
    public mutating func receive(_ chunk: Data) -> Output {
        var messages: [Data] = []
        for item in lines.append(chunk) {
            let replies: [Envelope]
            switch item {
            case .oversized:
                replies = [MessageRouter.oversizedLineError()]
            case .line(let line):
                if line.allSatisfy({ $0 == 0x20 || $0 == 0x09 || $0 == 0x0D }) { continue }
                replies = router.handle(line: line)
            }
            messages.append(contentsOf: replies.map(EnvelopeCodec.encode))
            if router.shouldExit { break }
        }
        return Output(messages: messages, shouldExit: router.shouldExit)
    }
}
