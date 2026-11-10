import Foundation
import XCTest

@testable import MurmurHelperCore

func line(_ text: String) -> Data { Data(text.utf8) }

func makeRouter(uptime: Int = 1234) -> MessageRouter {
    MessageRouter(uptimeMs: { uptime })
}

let validAck =
    #"{"id":"m-000001","type":"hello.ack","payload":{"accepted":true,"protocolVersion":1,"appVersion":"0.1.0"}}"#

func handshaken() -> MessageRouter {
    var router = makeRouter()
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
