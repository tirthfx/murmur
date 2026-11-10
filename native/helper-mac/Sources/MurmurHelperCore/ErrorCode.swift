/// Error codes the helper sends. Names and retryability follow the protocol spec.
public enum ErrorCode: String, Sendable {
    case handshakeRequired = "HANDSHAKE_REQUIRED"
    case protocolVersionMismatch = "PROTOCOL_VERSION_MISMATCH"
    case unsupportedRequest = "UNSUPPORTED_REQUEST"
    case invalidPayload = "INVALID_PAYLOAD"
    case permissionDenied = "PERMISSION_DENIED"
    case conflict = "CONFLICT"
    case notFound = "NOT_FOUND"
    case busy = "BUSY"
    case deviceNotFound = "DEVICE_NOT_FOUND"
    case audioEngineFailed = "AUDIO_ENGINE_FAILED"
    case `internal` = "INTERNAL"

    public var retryable: Bool {
        switch self {
        case .internal, .busy, .audioEngineFailed: return true
        case .handshakeRequired, .protocolVersionMismatch, .unsupportedRequest, .invalidPayload,
            .permissionDenied, .conflict, .notFound, .deviceNotFound:
            return false
        }
    }
}
