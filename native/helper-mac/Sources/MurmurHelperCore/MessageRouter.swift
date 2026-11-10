import Foundation

/// Turns inbound envelopes into outbound ones. Owns the handshake state.
/// It does no I/O, so every path is testable with plain values.
public struct MessageRouter: Sendable {
    private let helperVersion: String
    private let capabilities: [String]
    private let uptimeMs: @Sendable () -> Int
    private let permissions: any PermissionProvider
    private let hotkeys: HotkeyController?
    private let audio: AudioCaptureController?
    private var handshakeComplete = false

    /// Set once a `shutdown` request has been answered. The host exits after writing the reply.
    public private(set) var shouldExit = false

    public init(
        helperVersion: String = ProtocolConstants.helperVersion,
        capabilities: [String] = [],
        permissions: any PermissionProvider,
        hotkeys: HotkeyController? = nil,
        audio: AudioCaptureController? = nil,
        uptimeMs: @escaping @Sendable () -> Int
    ) {
        self.helperVersion = helperVersion
        self.capabilities = capabilities
        self.permissions = permissions
        self.hotkeys = hotkeys
        self.audio = audio
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
            hotkeys?.stop()
            audio?.shutdown()
            shouldExit = true
            return [Self.success(id: id, requestType: type, [:])]
        case "permissions.status":
            return [handlePermissionsStatus(id: id)]
        case "permissions.request":
            return [handlePermissionsRequest(id: id, payload: envelope.payload)]
        case "hotkey.configure":
            return [handleHotkeyConfigure(id: id, payload: envelope.payload)]
        case "audio.start", "audio.stop", "audio.cancel":
            return [handleAudio(id: id, type: type, payload: envelope.payload)]
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

    // MARK: Permissions

    private func handlePermissionsStatus(id: String) -> Envelope {
        var result: [String: JSONValue] = [:]
        for kind in PermissionKind.allCases {
            result[kind.rawValue] = .string(permissions.status(of: kind).rawValue)
        }
        return Self.success(id: id, requestType: "permissions.status", result)
    }

    private func handlePermissionsRequest(id: String, payload: [String: JSONValue]) -> Envelope {
        let type = "permissions.request"
        guard let name = payload["kind"]?.stringValue, let kind = PermissionKind(rawValue: name) else {
            return Self.failure(
                id: id, requestType: type, .invalidPayload,
                "permissions.request needs kind: microphone, accessibility, inputMonitoring or screenRecording")
        }
        guard kind.isRequestable else {
            return Self.failure(
                id: id, requestType: type, .unsupportedRequest,
                "Screen Recording cannot be requested in this version")
        }
        let status = permissions.request(kind)
        // The helper never opens System Settings itself; main does that on a separate click.
        return Self.success(
            id: id, requestType: type,
            ["status": .string(status.rawValue), "openedSettings": .bool(false)])
    }

    // MARK: Hotkeys

    private func handleHotkeyConfigure(id: String, payload: [String: JSONValue]) -> Envelope {
        let type = "hotkey.configure"
        guard let hotkeys else {
            return Self.failure(id: id, requestType: type, .unsupportedRequest, "Unknown request type")
        }
        switch hotkeys.configure(payload) {
        case .failure(.invalidPayload(let message)):
            return Self.failure(id: id, requestType: type, .invalidPayload, message)
        case .failure(.permissionDenied(let message)):
            return Self.failure(id: id, requestType: type, .permissionDenied, message)
        case .success(let outcome):
            return Self.success(
                id: id, requestType: type,
                [
                    "registered": .array(outcome.registered.map { .string($0) }),
                    "rejected": .array(
                        outcome.rejected.map {
                            .object([
                                "id": .string($0.id), "code": .string($0.code.rawValue),
                                "message": .string($0.message),
                            ])
                        }),
                ])
        }
    }

    // MARK: Audio

    private func handleAudio(id: String, type: String, payload: [String: JSONValue]) -> Envelope {
        guard let audio else {
            return Self.failure(id: id, requestType: type, .unsupportedRequest, "Unknown request type")
        }
        let result: Result<[String: JSONValue], AudioFailure>
        switch type {
        case "audio.start": result = audio.start(payload)
        case "audio.stop": result = audio.stop(payload)
        default: result = audio.cancel(payload)
        }
        switch result {
        case .success(let value): return Self.success(id: id, requestType: type, value)
        case .failure(let failure): return Self.failure(id: id, requestType: type, failure.code, failure.message)
        }
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
