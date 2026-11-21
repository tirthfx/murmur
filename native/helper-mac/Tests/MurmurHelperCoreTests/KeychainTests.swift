import Foundation
import XCTest

@testable import MurmurHelperCore

private final class FakeKeychain: KeychainStore, @unchecked Sendable {
    var items: [String: String] = [:]
    var failure: KeychainFailure?

    private func key(_ service: String, _ account: String) -> String { "\(service)|\(account)" }

    func get(service: String, account: String) throws -> String? {
        if let failure { throw failure }
        return items[key(service, account)]
    }

    func set(service: String, account: String, value: String) throws {
        if let failure { throw failure }
        items[key(service, account)] = value
    }

    func delete(service: String, account: String) throws -> Bool {
        if let failure { throw failure }
        return items.removeValue(forKey: key(service, account)) != nil
    }
}

final class KeychainTests: XCTestCase {
    private func call(
        _ controller: KeychainController, _ type: String, _ payload: [String: JSONValue]
    ) -> Envelope {
        controller.handle(id: "m-000001", type: type, payload: payload)
    }

    private let base: [String: JSONValue] = [
        "service": .string("com.murmur.connector.example"), "account": .string("a@example.com"),
    ]

    func testSetGetAndDeleteRoundTrip() {
        let store = FakeKeychain()
        let controller = KeychainController(store: store)
        var withValue = base
        withValue["value"] = .string("{\"accessToken\":\"x\"}")
        XCTAssertEqual(call(controller, "keychain.set", withValue).payload["ok"], .bool(true))

        let got = call(controller, "keychain.get", base).payload["result"]?.objectValue
        XCTAssertEqual(got?["found"], .bool(true))
        XCTAssertEqual(got?["value"], .string("{\"accessToken\":\"x\"}"))

        let deleted = call(controller, "keychain.delete", base).payload["result"]?.objectValue
        XCTAssertEqual(deleted?["deleted"], .bool(true))
        // Deleting again is not an error; it says there was nothing.
        let again = call(controller, "keychain.delete", base).payload["result"]?.objectValue
        XCTAssertEqual(again?["deleted"], .bool(false))
        let missing = call(controller, "keychain.get", base).payload["result"]?.objectValue
        XCTAssertEqual(missing?["found"], .bool(false))
        XCTAssertEqual(missing?["value"], .string(""))
    }

    func testSettingAgainReplacesTheValue() {
        let store = FakeKeychain()
        let controller = KeychainController(store: store)
        var first = base
        first["value"] = .string("one")
        var second = base
        second["value"] = .string("two")
        _ = call(controller, "keychain.set", first)
        _ = call(controller, "keychain.set", second)
        XCTAssertEqual(store.items.count, 1)
        XCTAssertEqual(
            call(controller, "keychain.get", base).payload["result"]?.objectValue?["value"], .string("two"))
    }

    func testRejectsBadPayloads() {
        let controller = KeychainController(store: FakeKeychain())
        func code(_ envelope: Envelope) -> JSONValue? {
            envelope.payload["error"]?.objectValue?["code"]
        }
        XCTAssertEqual(code(call(controller, "keychain.get", ["service": .string("s")])), .string("INVALID_PAYLOAD"))
        XCTAssertEqual(
            code(call(controller, "keychain.get", ["service": .string(""), "account": .string("a")])),
            .string("INVALID_PAYLOAD"))
        XCTAssertEqual(code(call(controller, "keychain.set", base)), .string("INVALID_PAYLOAD"))
        var empty = base
        empty["value"] = .string("")
        XCTAssertEqual(code(call(controller, "keychain.set", empty)), .string("INVALID_PAYLOAD"))
        var long = base
        long["value"] = .string(String(repeating: "x", count: 16_385))
        XCTAssertEqual(code(call(controller, "keychain.set", long)), .string("INVALID_PAYLOAD"))
    }

    func testAKeychainFailureIsReportedWithoutTheValue() {
        let store = FakeKeychain()
        store.failure = KeychainFailure(status: -25293)
        let controller = KeychainController(store: store)
        var withValue = base
        withValue["value"] = .string("secret-value")
        let reply = call(controller, "keychain.set", withValue)
        let error = reply.payload["error"]?.objectValue
        XCTAssertEqual(error?["code"], .string("INTERNAL"))
        XCTAssertTrue(error?["message"]?.stringValue?.contains("-25293") ?? false)
        XCTAssertFalse(error?["message"]?.stringValue?.contains("secret-value") ?? true)
    }

    func testTheRouterAnswersOnlyWhenAKeychainIsConfigured() {
        let get = #"{"id":"m-000002","type":"keychain.get","payload":{"service":"s","account":"a"}}"#
        var without = handshaken()
        XCTAssertEqual(errorCode(without.handle(line: line(get))[0]), "UNSUPPORTED_REQUEST")

        var with = MessageRouter(
            permissions: FakePermissionProvider(), keychain: KeychainController(store: FakeKeychain()),
            uptimeMs: { 0 })
        _ = with.handle(line: line(validAck))
        XCTAssertEqual(with.handle(line: line(get))[0].payload["ok"], .bool(true))
    }
}
