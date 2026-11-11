import Foundation

/// Changes in the event tap that main is told about.
public enum TapStatusChange: String, Sendable {
    case active
    case disabledBySystem = "disabled_by_system"
    case reenabled
}

/// The OS side of hotkeys: something that delivers key input. The real one is a
/// listen-only CGEvent tap; tests use a fake and never touch the keyboard.
public protocol KeyEventSource: AnyObject, Sendable {
    /// Starts delivering input. Returns false if it could not start. `onInput` receives the
    /// input and its time as Unix epoch milliseconds. Called on the source's own thread.
    func start(
        onInput: @escaping @Sendable (RawKeyInput, Int) -> Void,
        onStatus: @escaping @Sendable (TapStatusChange) -> Void
    ) -> Bool
    /// Stops delivering input. Safe to call when not started.
    func stop()
}

/// Owns the bindings, the matcher and the key source, and turns matches into events.
/// Called from the stdin loop (configure, stop) and from the source's thread (input).
public final class HotkeyController: @unchecked Sendable {
    // @unchecked: every mutable field is read and written only while `lock` is held.
    private let lock = NSLock()
    private var matcher = HotkeyMatcher()
    private var running = false
    private var typing: TypingCounter?
    private var typingTimer: DispatchSourceTimer?

    /// How often the typed-word count is reported while counting is on.
    public static let typingReportInterval: TimeInterval = 30

    private let source: any KeyEventSource
    private let permissions: any PermissionProvider
    private let emit: @Sendable (Envelope) -> Void

    /// `emit` sends one event to main. It must not block for long: it is called on the
    /// tap's thread, and a slow tap gets disabled by the OS.
    public init(
        source: any KeyEventSource,
        permissions: any PermissionProvider,
        emit: @escaping @Sendable (Envelope) -> Void
    ) {
        self.source = source
        self.permissions = permissions
        self.emit = emit
    }

    public enum ConfigureFailure: Error, Equatable {
        case invalidPayload(String)
        case permissionDenied(String)
    }

    public struct ConfigureOutcome: Equatable {
        public var registered: [String]
        public var rejected: [BindingRejection]
    }

    /// Handles a `hotkey.configure` payload: replaces all bindings, starting the tap when the
    /// first binding arrives and stopping it when none are left.
    public func configure(_ payload: [String: JSONValue]) -> Result<ConfigureOutcome, ConfigureFailure> {
        guard let parsed = HotkeyMatcher.parse(payload) else {
            return .failure(.invalidPayload(
                "hotkey.configure needs bindings: an array of at most \(HotkeyMatcher.maxBindings) bindings"))
        }
        var pending: [Envelope] = []
        let result: Result<ConfigureOutcome, ConfigureFailure> = lock.withLock {
            if parsed.valid.isEmpty {
                pending += matcher.replace(with: []).map(Self.event)
                if running {
                    source.stop()
                    running = false
                }
            } else if !running {
                // Never let a tap creation be the thing that asks for the permission:
                // the request belongs to a user click in the app.
                guard permissions.status(of: .inputMonitoring) == .granted else {
                    return .failure(.permissionDenied("inputMonitoring: Input Monitoring is not granted"))
                }
                let started = source.start(
                    onInput: { [weak self] input, at in self?.receive(input, at: at) },
                    onStatus: { [weak self] change in self?.statusChanged(change) })
                guard started else {
                    return .failure(.permissionDenied("inputMonitoring: the key listener could not be started"))
                }
                running = true
                pending.append(Self.tapStatus(.active))
                pending += matcher.replace(with: parsed.valid).map(Self.event)
            } else {
                pending += matcher.replace(with: parsed.valid).map(Self.event)
            }
            return .success(ConfigureOutcome(registered: parsed.valid.map(\.id), rejected: parsed.rejected))
        }
        pending.forEach(emit)
        return result
    }

    /// Stops the source. Used on shutdown.
    public func stop() {
        watchTyping(false)
        lock.withLock {
            if running { source.stop() }
            running = false
            _ = matcher.replace(with: [])
        }
    }

    public var isRunning: Bool { lock.withLock { running } }

    /// `typing.watch`: turns word counting on or off. Counting needs the key listener, so it
    /// only sees keys while a binding keeps the listener running. Off clears the count.
    public func watchTyping(_ enabled: Bool, interval: TimeInterval = HotkeyController.typingReportInterval) {
        let old = lock.withLock { () -> DispatchSourceTimer? in
            let timer = typingTimer
            typingTimer = nil
            typing = enabled ? TypingCounter() : nil
            return timer
        }
        old?.cancel()
        guard enabled else { return }
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
        timer.schedule(deadline: .now() + interval, repeating: interval)
        timer.setEventHandler { [weak self] in self?.reportTyping(periodMs: Int(interval * 1000)) }
        lock.withLock { typingTimer = timer }
        timer.resume()
    }

    public var isWatchingTyping: Bool { lock.withLock { typing != nil } }

    /// Sends the count since the last report, if any words were typed.
    func reportTyping(periodMs: Int) {
        let words = lock.withLock { typing?.take() ?? 0 }
        guard words > 0 else { return }
        emit(
            Envelope(
                id: nil, type: "typing.activity", payload: ["words": .int(words), "periodMs": .int(periodMs)]))
    }

    private func receive(_ input: RawKeyInput, at: Int) {
        // Unmatched input produces nothing: no event, no log line. The typing counter, when
        // on, keeps only a number.
        let firings = lock.withLock { () -> [HotkeyFiring] in
            typing?.handle(input)
            return matcher.handle(input)
        }
        for firing in firings { emit(Self.event(firing, at: at)) }
    }

    private func statusChanged(_ change: TapStatusChange) {
        var pending = [Self.tapStatus(change)]
        if change == .disabledBySystem {
            // Key-up events may be lost while the tap is off, so release held bindings now.
            pending += lock.withLock { matcher.releaseAll() }.map(Self.event)
        }
        pending.forEach(emit)
    }

    // MARK: Envelopes

    static func event(_ firing: HotkeyFiring) -> Envelope {
        event(firing, at: Int(Date().timeIntervalSince1970 * 1000))
    }

    static func event(_ firing: HotkeyFiring, at: Int) -> Envelope {
        var payload: [String: JSONValue] = [
            "bindingId": .string(firing.binding.id),
            "action": .string(firing.binding.action),
            "state": .string(firing.state.rawValue),
            "at": .int(at),
        ]
        if let rewriteId = firing.binding.rewriteId { payload["rewriteId"] = .string(rewriteId) }
        return Envelope(id: nil, type: "hotkey.event", payload: payload)
    }

    static func tapStatus(_ change: TapStatusChange) -> Envelope {
        Envelope(id: nil, type: "hotkey.tap.status", payload: ["state": .string(change.rawValue)])
    }
}

/// Converts CGEvent timestamps to Unix epoch milliseconds.
public enum EventClock {
    /// CGEvent timestamps count from boot. They are documented as nanoseconds, but on Apple
    /// silicon they have been seen in mach ticks, so both readings are tried and the one
    /// closest to now wins. Returns nil when neither is recent (for example a zero timestamp),
    /// and the caller then uses the time of receipt.
    public static func epochMs(
        eventTimestamp: UInt64,
        nowTicks: UInt64,
        numer: UInt32,
        denom: UInt32,
        nowEpochMs: Int,
        maxAgeMs: Int = 10_000
    ) -> Int? {
        guard eventTimestamp > 0, denom > 0 else { return nil }
        let toNs = { (ticks: UInt64) -> UInt64 in
            ticks.multipliedReportingOverflow(by: UInt64(numer)).overflow
                ? UInt64.max : ticks * UInt64(numer) / UInt64(denom)
        }
        let nowNs = toNs(nowTicks)
        let toleranceNs: UInt64 = 5_000_000  // allow 5 ms of clock disagreement
        let ages = [eventTimestamp, toNs(eventTimestamp)].compactMap { candidate -> UInt64? in
            if candidate <= nowNs { return nowNs - candidate }
            return candidate - nowNs <= toleranceNs ? 0 : nil
        }
        guard let ageNs = ages.min(), ageNs <= UInt64(maxAgeMs) * 1_000_000 else { return nil }
        return nowEpochMs - Int(ageNs / 1_000_000)
    }

    public static func epochMs(eventTimestamp: UInt64) -> Int {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        let now = Int(Date().timeIntervalSince1970 * 1000)
        return epochMs(
            eventTimestamp: eventTimestamp, nowTicks: mach_absolute_time(),
            numer: info.numer, denom: info.denom, nowEpochMs: now) ?? now
    }
}
