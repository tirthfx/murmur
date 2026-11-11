import Foundation

/// A text field being watched for corrections (PZ-02). The system one wraps an Accessibility
/// element; tests use a fake.
public protocol WatchedField: Sendable {
    /// The field's whole value now, or nil when it cannot be read.
    func value() -> String?
    /// Whether this field still has the keyboard focus.
    func isFocused() -> Bool
}

/// Finds the focused field to watch. Returns nil for a secure, read-only or unreadable field.
public protocol WatchedFieldSource: Sendable {
    func focusedField() -> (any WatchedField)?
}

/// The pure part of watching: where the inserted text is, and which of its words changed.
public enum EditDiff {
    /// The last place `text` occurs in `value`, as character offsets.
    public static func locate(_ text: String, in value: String) -> Range<Int>? {
        guard let range = value.range(of: text, options: .backwards) else { return nil }
        let start = value.distance(from: value.startIndex, to: range.lowerBound)
        return start..<(start + text.count)
    }

    public struct Change: Equatable, Sendable {
        public var before: String
        public var after: String
        /// Where the inserted text (as edited) now is, for watching on.
        public var span: Range<Int>
    }

    /// The words of the inserted span that changed between two values of the field. Nil when
    /// nothing changed inside the span, or when the text around it changed too (then the span
    /// can no longer be found reliably).
    public static func change(old: String, span: Range<Int>, new: String) -> Change? {
        let oldChars = Array(old)
        let newChars = Array(new)
        guard span.upperBound <= oldChars.count else { return nil }
        let prefix = oldChars[0..<span.lowerBound]
        let suffix = oldChars[span.upperBound...]
        guard newChars.count >= prefix.count + suffix.count,
            newChars.starts(with: prefix),
            Array(newChars.suffix(suffix.count)) == Array(suffix)
        else { return nil }
        let newSpan = span.lowerBound..<(newChars.count - suffix.count)
        let before = String(oldChars[span])
        let after = String(newChars[newSpan])
        guard before != after else { return nil }
        let (changedBefore, changedAfter) = changedWords(before, after)
        return Change(before: changedBefore, after: changedAfter, span: newSpan)
    }

    /// Drops the words both sides share at the start and the end.
    static func changedWords(_ before: String, _ after: String) -> (String, String) {
        let a = before.split(whereSeparator: \.isWhitespace).map(String.init)
        let b = after.split(whereSeparator: \.isWhitespace).map(String.init)
        var head = 0
        while head < a.count, head < b.count, a[head] == b[head] { head += 1 }
        var tail = 0
        while tail < a.count - head, tail < b.count - head, a[a.count - 1 - tail] == b[b.count - 1 - tail] {
            tail += 1
        }
        let clip = { (text: String) in String(text.prefix(200)) }
        return (
            clip(a[head..<(a.count - tail)].joined(separator: " ")),
            clip(b[head..<(b.count - tail)].joined(separator: " "))
        )
    }
}

/// `edits.watch` and `edits.cancel`. One watch at a time: the field is read every half
/// second; once an edit has rested for 1.5 s, the changed words are sent as `edits.changed`.
/// The watch ends when the time is up, the field loses focus, or it is cancelled.
public final class EditWatchController: @unchecked Sendable {
    // @unchecked: `generation` is only touched under `lock`.
    private let source: any WatchedFieldSource
    private let permissions: any PermissionProvider
    private let emit: @Sendable (Envelope) -> Void
    private let pollSeconds: Double
    private let restPolls: Int
    private let lock = NSLock()
    private var generation = 0

    public init(
        source: any WatchedFieldSource, permissions: any PermissionProvider,
        emit: @escaping @Sendable (Envelope) -> Void, pollSeconds: Double = 0.5, restPolls: Int = 3
    ) {
        self.source = source
        self.permissions = permissions
        self.emit = emit
        self.pollSeconds = pollSeconds
        self.restPolls = restPolls
    }

    public func handle(id: String, type: String, payload: [String: JSONValue]) -> Envelope {
        switch type {
        case "edits.cancel":
            let cancelled = lock.withLock { () -> Bool in
                generation += 1
                return true
            }
            return MessageRouter.success(id: id, requestType: type, ["cancelled": .bool(cancelled)])
        case "edits.watch":
            guard let text = payload["text"]?.stringValue, !text.isEmpty,
                let durationMs = payload["durationMs"]?.intValue, (1_000...60_000).contains(durationMs)
            else {
                return MessageRouter.failure(
                    id: id, requestType: type, .invalidPayload, "edits.watch needs text and durationMs (1000 to 60000)")
            }
            let token = lock.withLock { () -> Int in
                generation += 1
                return generation
            }
            guard permissions.status(of: .accessibility) == .granted,
                let field = source.focusedField(), let value = field.value(),
                let span = EditDiff.locate(text, in: value)
            else {
                return MessageRouter.success(id: id, requestType: type, ["watching": .bool(false)])
            }
            let deadline = Date().addingTimeInterval(Double(durationMs) / 1000)
            let thread = Thread { [weak self] in
                self?.watch(field: field, value: value, span: span, token: token, deadline: deadline)
            }
            thread.start()
            return MessageRouter.success(id: id, requestType: type, ["watching": .bool(true)])
        default:
            return MessageRouter.failure(id: id, requestType: type, .unsupportedRequest, "Unknown request type")
        }
    }

    private func isCurrent(_ token: Int) -> Bool { lock.withLock { generation == token } }

    private func watch(field: any WatchedField, value: String, span: Range<Int>, token: Int, deadline: Date) {
        var baseline = value
        var current = span
        var last = value
        var resting = 0
        while isCurrent(token), Date() < deadline {
            Thread.sleep(forTimeInterval: pollSeconds)
            guard isCurrent(token), field.isFocused(), let now = field.value() else { return }
            if now != last {
                last = now
                resting = 0
                continue
            }
            if now == baseline { continue }
            resting += 1
            guard resting >= restPolls else { continue }
            guard let change = EditDiff.change(old: baseline, span: current, new: now) else {
                // The text around the inserted words changed too: stop rather than guess.
                return
            }
            if isCurrent(token) {
                emit(
                    Envelope(
                        id: nil, type: "edits.changed",
                        payload: ["before": .string(change.before), "after": .string(change.after)]))
            }
            baseline = now
            current = change.span
            resting = 0
        }
    }
}
