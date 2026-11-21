import Foundation
import Security

/// A failure of the Keychain, with the system status for the log. Never carries a value.
public struct KeychainFailure: Error, Equatable, Sendable {
    public let status: Int32
    public init(status: Int32) { self.status = status }
}

/// Generic-password items in the Keychain (CN-01). Tests use a fake.
public protocol KeychainStore: Sendable {
    func get(service: String, account: String) throws -> String?
    func set(service: String, account: String, value: String) throws
    /// False when there was no such item.
    func delete(service: String, account: String) throws -> Bool
}

/// `keychain.get`, `keychain.set` and `keychain.delete`: the signed helper is the only Keychain
/// client, so no native module has to be rebuilt for Electron. Values are never logged.
public final class KeychainController: @unchecked Sendable {
    static let maxName = 200
    static let maxValue = 16_384

    private let store: any KeychainStore

    public init(store: any KeychainStore) {
        self.store = store
    }

    public func handle(id: String, type: String, payload: [String: JSONValue]) -> Envelope {
        guard let service = Self.name(payload["service"]), let account = Self.name(payload["account"]) else {
            return MessageRouter.failure(
                id: id, requestType: type, .invalidPayload,
                "\(type) needs a service and an account of 1 to \(Self.maxName) characters")
        }
        do {
            switch type {
            case "keychain.get":
                let value = try store.get(service: service, account: account)
                return MessageRouter.success(
                    id: id, requestType: type,
                    ["found": .bool(value != nil), "value": .string(value ?? "")])
            case "keychain.set":
                guard let value = payload["value"]?.stringValue, !value.isEmpty, value.count <= Self.maxValue else {
                    return MessageRouter.failure(
                        id: id, requestType: type, .invalidPayload,
                        "keychain.set needs a value of 1 to \(Self.maxValue) characters")
                }
                try store.set(service: service, account: account, value: value)
                return MessageRouter.success(id: id, requestType: type, ["ok": .bool(true)])
            default:
                let deleted = try store.delete(service: service, account: account)
                return MessageRouter.success(id: id, requestType: type, ["deleted": .bool(deleted)])
            }
        } catch let failure as KeychainFailure {
            Log.info("\(type) failed, status \(failure.status)")
            return MessageRouter.failure(
                id: id, requestType: type, .internal, "The Keychain refused the request (status \(failure.status))")
        } catch {
            return MessageRouter.failure(id: id, requestType: type, .internal, "The Keychain request failed")
        }
    }

    private static func name(_ value: JSONValue?) -> String? {
        guard let text = value?.stringValue, !text.isEmpty, text.count <= maxName else { return nil }
        return text
    }
}

/// The login keychain, through the Security framework. Items are readable only while the Mac is
/// unlocked and never leave this Mac.
public struct SystemKeychainStore: KeychainStore {
    public init() {}

    private func query(_ service: String, _ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func get(service: String, account: String) throws -> String? {
        var request = query(service, account)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainFailure(status: status) }
        guard let data = item as? Data, let text = String(data: data, encoding: .utf8) else { return nil }
        return text
    }

    public func set(service: String, account: String, value: String) throws {
        let data = Data(value.utf8)
        let update = SecItemUpdate(
            query(service, account) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw KeychainFailure(status: update) }
        var add = query(service, account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainFailure(status: status) }
    }

    public func delete(service: String, account: String) throws -> Bool {
        let status = SecItemDelete(query(service, account) as CFDictionary)
        if status == errSecItemNotFound { return false }
        guard status == errSecSuccess else { throw KeychainFailure(status: status) }
        return true
    }
}
