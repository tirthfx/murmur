import XCTest

@testable import MurmurHelperCore

final class MessageRouterTests: XCTestCase {
    func testHelloEventCarriesVersionsAndNullId() {
        let hello = makeRouter().helloEvent()
        XCTAssertNil(hello.id)
        XCTAssertEqual(hello.type, "hello")
        XCTAssertEqual(hello.payload["protocolVersion"], .int(ProtocolConstants.protocolVersion))
        XCTAssertEqual(hello.payload["helperVersion"], .string(ProtocolConstants.helperVersion))
        XCTAssertEqual(hello.payload["capabilities"], .array([]))
        XCTAssertNotNil(hello.payload["pid"]?.intValue)
        XCTAssertNotNil(hello.payload["macos"]?.objectValue)
    }

    func testProtocolVersionIsOne() {
        XCTAssertEqual(ProtocolConstants.protocolVersion, 1)
    }

    func testHandshakeThenPing() {
        var router = makeRouter(uptime: 99)
        let ack = router.handle(line: line(validAck))
        XCTAssertEqual(ack.count, 1)
        XCTAssertEqual(ack[0].id, "m-000001")
        XCTAssertEqual(ack[0].type, "response")
        XCTAssertEqual(ack[0].payload["requestType"], .string("hello.ack"))
        XCTAssertEqual(ack[0].payload["ok"], .bool(true))
        XCTAssertEqual(ack[0].payload["result"], .object(["ready": .bool(true)]))

        let pong = router.handle(line: line(#"{"id":"m-000002","type":"ping","payload":{}}"#))
        XCTAssertEqual(pong[0].id, "m-000002")
        XCTAssertEqual(pong[0].payload["result"], .object(["uptimeMs": .int(99)]))
    }

    func testRequestsBeforeAckAreRefused() {
        var router = makeRouter()
        let reply = router.handle(line: line(#"{"id":"m-000001","type":"ping","payload":{}}"#))
        XCTAssertEqual(errorCode(reply[0]), "HANDSHAKE_REQUIRED")
        XCTAssertEqual(reply[0].id, "m-000001")
    }

    func testAckWithOtherProtocolVersionIsRejected() {
        var router = makeRouter()
        let reply = router.handle(
            line: line(#"{"id":"m-000001","type":"hello.ack","payload":{"accepted":true,"protocolVersion":2,"appVersion":"x"}}"#))
        XCTAssertEqual(errorCode(reply[0]), "PROTOCOL_VERSION_MISMATCH")
        let ping = router.handle(line: line(#"{"id":"m-000002","type":"ping","payload":{}}"#))
        XCTAssertEqual(errorCode(ping[0]), "HANDSHAKE_REQUIRED")
    }

    func testRejectedAckKeepsHandshakeOpen() {
        var router = makeRouter()
        let reply = router.handle(
            line: line(#"{"id":"m-000001","type":"hello.ack","payload":{"accepted":false,"protocolVersion":1,"appVersion":"x","reason":"no"}}"#))
        XCTAssertEqual(reply[0].payload["result"], .object(["ready": .bool(false)]))
        let ping = router.handle(line: line(#"{"id":"m-000002","type":"ping","payload":{}}"#))
        XCTAssertEqual(errorCode(ping[0]), "HANDSHAKE_REQUIRED")
    }

    func testAckWithBadPayloadIsInvalidPayload() {
        var router = makeRouter()
        let reply = router.handle(line: line(#"{"id":"m-000001","type":"hello.ack","payload":{"accepted":"yes"}}"#))
        XCTAssertEqual(errorCode(reply[0]), "INVALID_PAYLOAD")
    }

    func testUnknownTypeGetsUnsupportedRequest() {
        var router = handshaken()
        let reply = router.handle(line: line(#"{"id":"m-000005","type":"does.not.exist","payload":{}}"#))
        XCTAssertEqual(reply.count, 1)
        XCTAssertEqual(reply[0].id, "m-000005")
        XCTAssertEqual(reply[0].payload["requestType"], .string("does.not.exist"))
        XCTAssertEqual(errorCode(reply[0]), "UNSUPPORTED_REQUEST")
        XCTAssertFalse(router.shouldExit)
    }

    func testMalformedJSONGivesHelperErrorEventAndKeepsWorking() {
        var router = handshaken()
        let reply = router.handle(line: line("{nope"))
        XCTAssertEqual(reply.count, 1)
        XCTAssertNil(reply[0].id)
        XCTAssertEqual(reply[0].type, "helper.error")
        XCTAssertEqual(reply[0].payload["code"], .string("INVALID_PAYLOAD"))
        XCTAssertEqual(reply[0].payload["fatal"], .bool(false))
        let pong = router.handle(line: line(#"{"id":"m-000006","type":"ping","payload":{}}"#))
        XCTAssertEqual(pong[0].payload["ok"], .bool(true))
    }

    func testInvalidEnvelopeWithIdGetsResponseForThatId() {
        var router = handshaken()
        let reply = router.handle(line: line(#"{"id":"m-000007","type":"ping","payload":[]}"#))
        XCTAssertEqual(reply[0].id, "m-000007")
        XCTAssertEqual(errorCode(reply[0]), "INVALID_PAYLOAD")
    }

    func testRequestWithNullIdIsRefused() {
        var router = handshaken()
        let reply = router.handle(line: line(#"{"id":null,"type":"ping","payload":{}}"#))
        XCTAssertEqual(reply[0].type, "helper.error")
    }

    func testShutdownRepliesThenAsksToExit() {
        var router = handshaken()
        let reply = router.handle(line: line(#"{"id":"m-000008","type":"shutdown","payload":{"reason":"app-quit"}}"#))
        XCTAssertEqual(reply[0].payload["ok"], .bool(true))
        XCTAssertTrue(router.shouldExit)
    }
}

final class HelperHostTests: XCTestCase {
    func testGreetingIsHelloLine() {
        let host = HelperHost(router: makeRouter())
        let text = String(decoding: host.greeting(), as: UTF8.self)
        XCTAssertTrue(text.hasPrefix(#"{"id":null,"type":"hello","payload":{"#))
        XCTAssertTrue(text.hasSuffix("}\n"))
    }

    func testHandlesPartialAndMultipleMessages() {
        var host = HelperHost(router: makeRouter())
        let first = host.receive(line(validAck + "\n" + #"{"id":"m-000002","type":"pi"#))
        XCTAssertEqual(first.messages.count, 1)
        let second = host.receive(line(#"ng","payload":{}}"# + "\n\n   \n" + "garbage\n"))
        XCTAssertEqual(second.messages.count, 2)
        XCTAssertFalse(second.shouldExit)
    }

    func testStopsAfterShutdown() {
        var host = HelperHost(router: makeRouter())
        let output = host.receive(
            line(validAck + "\n" + #"{"id":"m-000002","type":"shutdown","payload":{"reason":"x"}}"# + "\n" + #"{"id":"m-000003","type":"ping","payload":{}}"# + "\n"))
        XCTAssertEqual(output.messages.count, 2)
        XCTAssertTrue(output.shouldExit)
    }

    func testOversizedLineGetsErrorEvent() {
        var host = HelperHost(router: makeRouter(), lines: LineBuffer(maxLineBytes: 16))
        let output = host.receive(line(String(repeating: "x", count: 40) + "\n"))
        XCTAssertEqual(output.messages.count, 1)
        XCTAssertTrue(String(decoding: output.messages[0], as: UTF8.self).contains("helper.error"))
    }
}
