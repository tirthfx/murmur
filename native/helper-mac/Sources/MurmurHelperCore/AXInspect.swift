import AppKit
import Foundation

/// An element in an app's accessibility tree, as the inspector sees it. Tests use a fake.
public protocol InspectableElement: AnyObject {
    var role: String? { get }
    var subrole: String? { get }
    var title: String? { get }
    var isEditable: Bool { get }
    /// Only asked for when values are shown, and never for a secure field.
    func value() -> String?
    var selectedRange: (location: Int, length: Int)? { get }
    func children() -> [any InspectableElement]
}

/// One row of the inspector's tree (HB-56).
public struct InspectedNode: Equatable, Sendable {
    public let depth: Int
    public let role: String?
    public let subrole: String?
    public let title: String?
    public let editable: Bool
    public let secure: Bool
    public let selectedRange: [Int]?
    public let value: String?

    var json: JSONValue {
        .object([
            "depth": .int(depth),
            "role": role.map { .string(String($0.prefix(80))) } ?? .null,
            "subrole": subrole.map { .string(String($0.prefix(80))) } ?? .null,
            "title": title.map { .string(String($0.prefix(200))) } ?? .null,
            "editable": .bool(editable),
            "secure": .bool(secure),
            "selectedRange": selectedRange.map { .array($0.map { .int($0) }) } ?? .null,
            "value": value.map { .string($0) } ?? .null,
        ])
    }
}

/// HB-56: walks a window's tree depth first, at most `maxDepth` deep and `maxNodes` nodes.
/// Values are read only when asked, cut to 200 characters, and never for secure fields.
public enum AXInspector {
    public static let maxDepth = 6
    public static let maxNodes = 500
    static let maxValue = 200

    public static func walk(
        root: any InspectableElement, showValues: Bool, maxDepth: Int = maxDepth, maxNodes: Int = maxNodes
    ) -> (nodes: [InspectedNode], truncated: Bool) {
        var nodes: [InspectedNode] = []
        var truncated = false
        var stack: [(any InspectableElement, Int)] = [(root, 0)]
        while let (element, depth) = stack.popLast() {
            if nodes.count >= maxNodes {
                truncated = true
                break
            }
            let secure = FocusContext.isSecure(role: element.role, subrole: element.subrole)
            let value = showValues && !secure ? element.value().map { String($0.prefix(maxValue)) } : nil
            let range = secure ? nil : element.selectedRange.map { [$0.location, $0.length] }
            nodes.append(
                InspectedNode(
                    depth: depth, role: element.role, subrole: element.subrole, title: element.title,
                    editable: element.isEditable, secure: secure, selectedRange: range, value: value))
            if depth >= maxDepth {
                if !element.children().isEmpty { truncated = true }
                continue
            }
            // Pushed in reverse so the first child is visited first.
            for child in element.children().reversed() { stack.append((child, depth + 1)) }
        }
        return (nodes, truncated)
    }
}

/// Where the inspector gets the app in front and its focused window.
public protocol InspectSource: Sendable {
    func target() -> (app: FrontAppInfo, window: any InspectableElement)?
}

/// `ax.inspect` (HB-56): the focused window of the app in front, as rows. Nothing is kept.
public final class AXInspectController: @unchecked Sendable {
    private let source: any InspectSource
    private let permissions: any PermissionProvider

    public init(source: any InspectSource, permissions: any PermissionProvider) {
        self.source = source
        self.permissions = permissions
    }

    public func handle(id: String, payload: [String: JSONValue]) -> Envelope {
        let type = "ax.inspect"
        guard let showValues = payload["showValues"]?.boolValue else {
            return MessageRouter.failure(id: id, requestType: type, .invalidPayload, "ax.inspect needs showValues")
        }
        guard permissions.status(of: .accessibility) == .granted else {
            return MessageRouter.failure(
                id: id, requestType: type, .permissionDenied, "Accessibility access is not granted")
        }
        guard let (app, window) = source.target() else {
            return MessageRouter.success(
                id: id, requestType: type,
                ["app": .null, "bundleId": .null, "nodes": .array([]), "truncated": .bool(false)])
        }
        let (nodes, truncated) = AXInspector.walk(root: window, showValues: showValues)
        return MessageRouter.success(
            id: id, requestType: type,
            [
                "app": app.name.map { .string(String($0.prefix(200))) } ?? .null,
                "bundleId": app.bundleId.map { .string(String($0.prefix(255))) } ?? .null,
                "nodes": .array(nodes.map(\.json)),
                "truncated": .bool(truncated),
            ])
    }
}

/// The system element: one AXUIElement.
final class SystemInspectable: InspectableElement {
    let element: AXUIElement

    init(_ element: AXUIElement) {
        self.element = element
        AXUIElementSetMessagingTimeout(element, 0.25)
    }

    private func string(_ name: String) -> String? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value as? String
    }

    var role: String? { string(kAXRoleAttribute) }
    var subrole: String? { string(kAXSubroleAttribute) }
    var title: String? { string(kAXTitleAttribute) ?? string(kAXDescriptionAttribute) }

    var isEditable: Bool {
        var settable: DarwinBoolean = false
        return AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success
            && settable.boolValue
    }

    func value() -> String? { string(kAXValueAttribute) }

    var selectedRange: (location: Int, length: Int)? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &value) == .success,
            let value, CFGetTypeID(value) == AXValueGetTypeID()
        else { return nil }
        var range = CFRange()
        guard AXValueGetValue(value as! AXValue, .cfRange, &range) else { return nil }
        return (range.location, range.length)
    }

    func children() -> [any InspectableElement] {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
            let list = value as? [AXUIElement]
        else { return [] }
        return list.map { SystemInspectable($0) }
    }
}

public struct SystemInspectSource: InspectSource {
    public init() {}

    public func target() -> (app: FrontAppInfo, window: any InspectableElement)? {
        guard let running = Frontmost.application() else { return nil }
        let app = AXUIElementCreateApplication(running.processIdentifier)
        AXUIElementSetMessagingTimeout(app, 0.25)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &value) == .success,
            let value, CFGetTypeID(value) == AXUIElementGetTypeID()
        else { return nil }
        let info = FrontAppInfo(
            bundleId: running.bundleIdentifier, name: running.localizedName, pid: Int(running.processIdentifier))
        return (info, SystemInspectable(value as! AXUIElement))
    }
}
