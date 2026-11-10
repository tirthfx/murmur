import Foundation

/// Splits a byte stream into newline-terminated lines. Handles partial lines across
/// chunks, several lines in one chunk, and lines longer than the limit (which are dropped
/// and reported once).
public struct LineBuffer: Sendable {
    public enum Item: Sendable, Equatable {
        case line(Data)
        case oversized
    }

    private let maxLineBytes: Int
    private var buffer = Data()
    private var discarding = false

    public init(maxLineBytes: Int = ProtocolConstants.maxLineBytes) {
        self.maxLineBytes = maxLineBytes
    }

    public mutating func append(_ chunk: Data) -> [Item] {
        var items: [Item] = []
        var rest = chunk[...]
        while true {
            if let newline = rest.firstIndex(of: 0x0A) {
                let piece = rest[rest.startIndex..<newline]
                rest = rest[(newline + 1)...]
                if discarding {
                    discarding = false
                } else if buffer.count + piece.count > maxLineBytes {
                    items.append(.oversized)
                } else {
                    buffer.append(contentsOf: piece)
                    items.append(.line(buffer))
                }
                buffer = Data()
            } else {
                if !discarding {
                    if buffer.count + rest.count > maxLineBytes {
                        discarding = true
                        buffer = Data()
                        items.append(.oversized)
                    } else {
                        buffer.append(contentsOf: rest)
                    }
                }
                break
            }
        }
        return items
    }
}
