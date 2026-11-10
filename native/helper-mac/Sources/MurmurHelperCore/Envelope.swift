import Foundation

/// The wire envelope: `{"id": ..., "type": ..., "payload": {...}}`.
public struct Envelope: Sendable, Equatable {
    public var id: String?
    public var type: String
    public var payload: [String: JSONValue]

    public init(id: String?, type: String, payload: [String: JSONValue] = [:]) {
        self.id = id
        self.type = type
        self.payload = payload
    }
}

public enum EnvelopeError: Error, Sendable, Equatable {
    /// The line is not valid JSON.
    case malformedJSON
    /// Valid JSON that is not a valid envelope. `id` and `type` are kept when they could be read,
    /// so the caller can answer the right request.
    case invalidEnvelope(reason: String, id: String?, type: String?)
}

public enum EnvelopeCodec {
    private static let keys: Set<String> = ["id", "type", "payload"]

    public static func decode(line: Data) -> Result<Envelope, EnvelopeError> {
        guard let value = try? JSONDecoder().decode(JSONValue.self, from: line) else {
            return .failure(.malformedJSON)
        }
        guard case .object(let object) = value else {
            return .failure(.invalidEnvelope(reason: "Message is not a JSON object", id: nil, type: nil))
        }
        let id = object["id"]?.stringValue
        let type = object["type"]?.stringValue
        func invalid(_ reason: String) -> Result<Envelope, EnvelopeError> {
            .failure(.invalidEnvelope(reason: reason, id: id, type: type))
        }
        guard Set(object.keys) == keys else {
            return invalid("Envelope must have exactly the keys id, type and payload")
        }
        guard let type, !type.isEmpty else {
            return invalid("Envelope type must be a non-empty string")
        }
        let envelopeId: String?
        switch object["id"] {
        case .some(.string(let value)): envelopeId = value
        case .some(.null): envelopeId = nil
        default: return invalid("Envelope id must be a string or null")
        }
        guard case .some(.object(let payload)) = object["payload"] else {
            return invalid("Envelope payload must be an object")
        }
        return .success(Envelope(id: envelopeId, type: type, payload: payload))
    }

    /// Encodes one envelope as a single line including the trailing newline.
    /// Keys are written in the order `id`, `type`, `payload`; payload keys are sorted.
    public static func encode(_ envelope: Envelope) -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let idValue: JSONValue = envelope.id.map { .string($0) } ?? .null
        var out = Data("{\"id\":".utf8)
        out.append(encodeValue(idValue, with: encoder))
        out.append(Data(",\"type\":".utf8))
        out.append(encodeValue(.string(envelope.type), with: encoder))
        out.append(Data(",\"payload\":".utf8))
        out.append(encodeValue(.object(envelope.payload), with: encoder))
        out.append(contentsOf: [0x7D, 0x0A])  // closing brace, newline
        return out
    }

    private static func encodeValue(_ value: JSONValue, with encoder: JSONEncoder) -> Data {
        // Encoding a JSONValue cannot fail: every case is representable, and doubles that are
        // not finite never come from decoded input.
        (try? encoder.encode(value)) ?? Data("null".utf8)
    }
}
