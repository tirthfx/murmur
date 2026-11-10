/// Error codes the helper sends. Names and retryability follow the protocol spec.
public enum ErrorCode: String, Sendable {
    case handshakeRequired = "HANDSHAKE_REQUIRED"
    case protocolVersionMismatch = "PROTOCOL_VERSION_MISMATCH"
    case unsupportedRequest = "UNSUPPORTED_REQUEST"
    case invalidPayload = "INVALID_PAYLOAD"
    case `internal` = "INTERNAL"

    public var retryable: Bool {
        switch self {
        case .internal: return true
        case .handshakeRequired, .protocolVersionMismatch, .unsupportedRequest, .invalidPayload:
            return false
        }
    }
}
