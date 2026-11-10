import Foundation
import XCTest

@testable import MurmurHelperCore

func line(_ text: String) -> Data { Data(text.utf8) }

/// Stands in for the OS. Records every call so tests can prove what was (not) requested.
final class FakePermissionProvider: PermissionProvider, @unchecked Sendable {
    private let lock = NSLock()
    private var statuses: [PermissionKind: PermissionStatus]
    private var requested: [PermissionKind] = []
    private var statusReads = 0
    /// What a request leaves the status as, per kind. Defaults to leaving it unchanged.
    private var afterRequest: [PermissionKind: PermissionStatus] = [:]

    init(_ statuses: [PermissionKind: PermissionStatus] = [:]) {
        self.statuses = statuses
    }

    var requests: [PermissionKind] { lock.withLock { requested } }
    var reads: Int { lock.withLock { statusReads } }

    func set(_ kind: PermissionKind, _ status: PermissionStatus) {
        lock.withLock { statuses[kind] = status }
    }

    func setAfterRequest(_ kind: PermissionKind, _ status: PermissionStatus) {
        lock.withLock { afterRequest[kind] = status }
    }

    func status(of kind: PermissionKind) -> PermissionStatus {
        lock.withLock {
            statusReads += 1
            return statuses[kind] ?? .unknown
        }
    }

    func request(_ kind: PermissionKind) -> PermissionStatus {
        lock.withLock {
            requested.append(kind)
            if let next = afterRequest[kind] { statuses[kind] = next }
            return statuses[kind] ?? .unknown
        }
    }
}

func makeRouter(
    uptime: Int = 1234,
    permissions: any PermissionProvider = FakePermissionProvider()
) -> MessageRouter {
    MessageRouter(permissions: permissions, uptimeMs: { uptime })
}

let validAck =
    #"{"id":"m-000001","type":"hello.ack","payload":{"accepted":true,"protocolVersion":1,"appVersion":"0.1.0"}}"#

func handshaken(permissions: any PermissionProvider = FakePermissionProvider()) -> MessageRouter {
    var router = makeRouter(permissions: permissions)
    _ = router.handle(line: line(validAck))
    return router
}

func errorCode(_ envelope: Envelope) -> String? {
    envelope.payload["error"]?.objectValue?["code"]?.stringValue
}

func fixtureURL(_ name: String, filePath: String = #filePath) -> URL {
    URL(fileURLWithPath: filePath)
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("packages/shared/protocol-fixtures/\(name)")
}
