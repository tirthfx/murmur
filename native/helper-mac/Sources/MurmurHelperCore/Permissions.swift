/// The permissions Murmur relies on. Raw values are the wire names.
public enum PermissionKind: String, Sendable, CaseIterable {
    case microphone
    case accessibility
    case inputMonitoring
    case screenRecording

    /// Screen Recording is status only in this version: the helper never asks for it.
    public var isRequestable: Bool { self != .screenRecording }
}

/// `notDetermined` means the user was never asked. `unknown` means the OS does not report
/// a clean state for this permission.
public enum PermissionStatus: String, Sendable, Equatable {
    case granted
    case denied
    case notDetermined = "not_determined"
    case unknown
}

/// The OS calls behind the permission messages. The router only talks to this protocol,
/// so tests use a fake and never touch the real privacy database or show a system prompt.
public protocol PermissionProvider: Sendable {
    /// Reads the current status. Must never show a prompt.
    func status(of kind: PermissionKind) -> PermissionStatus

    /// Asks the OS for the permission, which may show a system prompt. Must return at once
    /// without waiting for the user, and returns the status at that moment. Only called for
    /// kinds where `isRequestable` is true.
    func request(_ kind: PermissionKind) -> PermissionStatus
}
