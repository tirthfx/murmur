import Foundation

/// Turns inbound envelopes into outbound ones. Owns the handshake state.
/// It does no I/O, so every path is testable with plain values.
public struct MessageRouter: Sendable {
    private let helperVersion: String
    private let capabilities: [String]
    private let uptimeMs: @Sendable () -> Int
    private var handshakeComplete = false

    /// Set once a `shutdown` request has been answered. The host exits after writing the reply.
    public private(set) var shouldExit = false

    public init(
        helperVersion: String = ProtocolConstants.helperVersion,
        capabilities: [String] = [],
        uptimeMs: @escaping @Sendable () -> Int
    ) {
        self.helperVersion = helperVersion
        self.capabilities = capabilities
        self.uptimeMs = uptimeMs
    }

    /// The `hello` event the helper sends once at start.
    public func helloEvent() -> Envelope {
        Envelope(
            id: nil,
            type: "hello",
            payload: [
                "protocolVersion": .int(ProtocolConstants.protocolVersion),
                "helperVersion": .string(helperVersion),
                "capabilities": .array(capabilities.map { .string($0) }),
                "macos": .object(HostInfo.macOS()),
                "pid": .int(Int(ProcessInfo.processInfo.processIdentifier)),
            ]
        )
    }

    /// Handles one line from stdin. Never throws and never traps on bad input.
    public mutating func handle(line: Data) -> [Envelope] {
        switch EnvelopeCodec.decode(line: line) {
        case .failure(.malformedJSON):
            return [Self.helperError(.invalidPayload, "Line is not valid JSON")]
        case .failure(.invalidEnvelope(let reason, let id, let type)):
            guard let id else { return [Self.helperError(.invalidPayload, reason)] }
            return [Self.failure(id: id, requestType: type ?? "", .invalidPayload, reason)]
        case .success(let envelope):
            return route(envelope)
        }
    }

    public static func oversizedLineError() -> Envelope {
        helperError(.invalidPayload, "Line exceeds \(ProtocolConstants.maxLineBytes) bytes and was dropped")
    }

    // MARK: Routing

    private mutating func route(_ envelope: Envelope) -> [Envelope] {
        guard let id = envelope.id else {
            return [Self.helperError(.invalidPayload, "Requests must carry an id")]
        }
        let type = envelope.type
        if type == "hello.ack" {
            return [handleAck(id: id, payload: envelope.payload)]
        }
        guard handshakeComplete else {
            return [Self.failure(id: id, requestType: type, .handshakeRequired, "Send hello.ack before any other request")]
        }
        switch type {
        case "ping":
            return [Self.success(id: id, requestType: type, ["uptimeMs": .int(uptimeMs())])]
        case "shutdown":
            shouldExit = true
            return [Self.success(id: id, requestType: type, [:])]
        default:
            return [Self.failure(id: id, requestType: type, .unsupportedRequest, "Unknown request type")]
        }
    }

    private mutating func handleAck(id: String, payload: [String: JSONValue]) -> Envelope {
        let type = "hello.ack"
        guard
            let accepted = payload["accepted"]?.boolValue,
            let version = payload["protocolVersion"]?.intValue,
            payload["appVersion"]?.stringValue != nil
        else {
            return Self.failure(
                id: id, requestType: type, .invalidPayload,
                "hello.ack needs accepted (bool), protocolVersion (int) and appVersion (string)")
        }
        guard version == ProtocolConstants.protocolVersion else {
            return Self.failure(
                id: id, requestType: type, .protocolVersionMismatch,
                "Helper speaks protocol \(ProtocolConstants.protocolVersion), main sent \(version)")
        }
        handshakeComplete = accepted
        return Self.success(id: id, requestType: type, ["ready": .bool(accepted)])
    }

    // MARK: Message builders

    static func success(id: String, requestType: String, _ result: [String: JSONValue]) -> Envelope {
        Envelope(
            id: id, type: "response",
            payload: [
                "requestType": .string(requestType),
                "ok": .bool(true),
                "result": .object(result),
            ])
    }

    static func failure(id: String, requestType: String, _ code: ErrorCode, _ message: String) -> Envelope {
        Envelope(
            id: id, type: "response",
            payload: [
                "requestType": .string(requestType),
                "ok": .bool(false),
                "error": .object([
                    "code": .string(code.rawValue),
                    "message": .string(message),
                    "retryable": .bool(code.retryable),
                ]),
            ])
    }

    static func helperError(_ code: ErrorCode, _ message: String, fatal: Bool = false) -> Envelope {
        Envelope(
            id: nil, type: "helper.error",
            payload: [
                "code": .string(code.rawValue),
                "message": .string(message),
                "fatal": .bool(fatal),
            ])
    }
}
