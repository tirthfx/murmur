import XCTest

@testable import MurmurHelperCore

final class EnvelopeTests: XCTestCase {
    func testEncodesIdTypePayloadOnOneLine() {
        let data = EnvelopeCodec.encode(Envelope(id: nil, type: "helper.error", payload: ["fatal": .bool(false)]))
        XCTAssertEqual(
            String(decoding: data, as: UTF8.self),
            "{\"id\":null,\"type\":\"helper.error\",\"payload\":{\"fatal\":false}}\n")
    }

    func testEncodedStringsWithNewlinesStayOnOneLine() {
        let data = EnvelopeCodec.encode(Envelope(id: "m-1", type: "x", payload: ["text": .string("a\nb/c")]))
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertEqual(text.filter { $0 == "\n" }.count, 1)
        XCTAssertTrue(text.contains("a\\nb/c"))
    }

    func testRoundTrip() throws {
        let original = Envelope(
            id: "m-000007", type: "ping",
            payload: ["n": .int(3), "d": .double(1.5), "list": .array([.null, .bool(true)]), "s": .string("é")])
        let decoded = try EnvelopeCodec.decode(line: EnvelopeCodec.encode(original)).get()
        XCTAssertEqual(decoded, original)
    }

    func testDecodeRejectsBadEnvelopes() {
        let bad = [
            "not json", #"{"id":null"#, "[]", "42", "{}",
            #"{"id":null,"type":"hello"}"#,
            #"{"id":null,"type":"","payload":{}}"#,
            #"{"id":7,"type":"ping","payload":{}}"#,
            #"{"id":"m-1","type":"ping","payload":[]}"#,
            #"{"id":"m-1","type":"ping","payload":{},"extra":true}"#,
        ]
        for text in bad {
            if case .success = EnvelopeCodec.decode(line: line(text)) {
                XCTFail("should have rejected: \(text)")
            }
        }
    }

    func testInvalidEnvelopeKeepsIdAndType() {
        let result = EnvelopeCodec.decode(line: line(#"{"id":"m-9","type":"ping","payload":[]}"#))
        guard case .failure(.invalidEnvelope(_, let id, let type)) = result else {
            return XCTFail("expected invalidEnvelope")
        }
        XCTAssertEqual(id, "m-9")
        XCTAssertEqual(type, "ping")
    }
}

final class FixtureTests: XCTestCase {
    private func loadFixture(_ name: String) throws -> [String: JSONValue] {
        let data = try Data(contentsOf: fixtureURL(name))
        return try JSONDecoder().decode(JSONValue.self, from: data).objectValue ?? [:]
    }

    func testEveryFixtureMessageDecodesAsAnEnvelope() throws {
        let names = ["hello.json", "hello.ack.json", "ping.json", "shutdown.json", "helper.error.json", "unsupported.json", "permissions.status.json", "permissions.request.json", "hotkey.configure.json", "hotkey.event.json", "audio.capture.json", "transcribe.json", "insert.json"]
        for name in names {
            guard case .array(let messages)? = try loadFixture(name)["messages"] else {
                return XCTFail("\(name) has no messages")
            }
            XCTAssertFalse(messages.isEmpty, name)
            for message in messages {
                let data = try JSONEncoder().encode(message)
                if case .failure(let error) = EnvelopeCodec.decode(line: data) {
                    XCTFail("\(name): \(error)")
                }
            }
        }
    }

    func testInvalidLinesAreRejected() throws {
        guard case .array(let lines)? = try loadFixture("invalid-lines.json")["invalidLines"] else {
            return XCTFail("no invalidLines")
        }
        XCTAssertFalse(lines.isEmpty)
        for value in lines {
            guard case .string(let text) = value else { return XCTFail("not a string") }
            if case .success = EnvelopeCodec.decode(line: line(text)) {
                XCTFail("should have rejected: \(text)")
            }
        }
    }

    func testRouterAnswersFixtureRequestsLikeTheFixtureResponses() throws {
        var router = makeRouter(uptime: 5012)
        guard case .array(let messages)? = try loadFixture("hello.ack.json")["messages"] else {
            return XCTFail("no messages")
        }
        let ack = try JSONEncoder().encode(messages[0])
        let reply = router.handle(line: ack)
        XCTAssertEqual(reply.count, 1)
        XCTAssertEqual(reply[0].payload["result"]?.objectValue?["ready"]?.boolValue, true)
    }

    func testRouterAnswersPermissionFixtures() throws {
        let fake = FakePermissionProvider([
            .microphone: .granted, .accessibility: .denied,
            .inputMonitoring: .notDetermined, .screenRecording: .unknown,
        ])
        var router = handshaken(permissions: fake)

        guard case .array(let status)? = try loadFixture("permissions.status.json")["messages"] else {
            return XCTFail("no messages")
        }
        let statusReply = router.handle(line: try JSONEncoder().encode(status[0]))
        XCTAssertEqual(try replyJSON(statusReply[0]), try expectedJSON(status[1]))

        guard case .array(let request)? = try loadFixture("permissions.request.json")["messages"] else {
            return XCTFail("no messages")
        }
        fake.set(.microphone, .notDetermined)  // the request fixture shows a never-asked state
        let okReply = router.handle(line: try JSONEncoder().encode(request[0]))
        XCTAssertEqual(try replyJSON(okReply[0]), try expectedJSON(request[1]))
        let refused = router.handle(line: try JSONEncoder().encode(request[2]))
        XCTAssertEqual(try replyJSON(refused[0]), try expectedJSON(request[3]))
    }

    func testRouterRejectsInvalidPermissionFixtureRequests() throws {
        var router = handshaken()
        guard case .array(let invalid)? = try loadFixture("permissions.request.json")["invalidMessages"] else {
            return XCTFail("no invalid messages")
        }
        for message in invalid {
            guard message.objectValue?["type"]?.stringValue == "permissions.request" else { continue }
            let reply = router.handle(line: try JSONEncoder().encode(message))
            XCTAssertEqual(errorCode(reply[0]), "INVALID_PAYLOAD")
        }
    }

    private func replyJSON(_ envelope: Envelope) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: EnvelopeCodec.encode(envelope))
    }

    private func expectedJSON(_ value: JSONValue) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
    }
}
