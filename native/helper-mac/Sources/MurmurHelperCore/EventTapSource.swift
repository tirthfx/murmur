import CoreGraphics
import Foundation

/// The real key source: a listen-only CGEvent tap on its own thread and run loop.
/// Listen-only means the tap only observes. It never changes, drops or delays an event
/// for the app in front.
///
/// Secure input (password fields, some terminals) stops key events reaching any tap.
/// Nothing is reported for that yet.
public final class EventTapSource: KeyEventSource, @unchecked Sendable {
    // @unchecked: `state` is read and written only while `lock` is held. The tap and run
    // loop references inside it are CF objects that are safe to use from any thread.
    private let lock = NSLock()
    private var state: Running?

    private struct Running {
        var tap: CFMachPort
        var runLoop: CFRunLoop
        var handler: Unmanaged<TapHandler>
    }

    public init() {}

    public func start(
        onInput: @escaping @Sendable (RawKeyInput, Int) -> Void,
        onStatus: @escaping @Sendable (TapStatusChange) -> Void
    ) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if state != nil { return true }

        let handler = Unmanaged.passRetained(TapHandler(onInput: onInput, onStatus: onStatus))
        // Extra mouse buttons only; left and right clicks are not even observed.
        let types: [CGEventType] = [.flagsChanged, .keyDown, .keyUp, .otherMouseDown, .otherMouseUp]
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << CGEventMask($1.rawValue)) }
        guard
            let tap = CGEvent.tapCreate(
                tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                eventsOfInterest: mask, callback: eventTapCallback, userInfo: handler.toOpaque())
        else {
            handler.release()
            return false
        }
        handler.takeUnretainedValue().setTap(tap)

        let started = DispatchSemaphore(value: 0)
        let box = RunLoopBox()
        let parts = UncheckedSendable((tap, box))
        let thread = Thread {
            let (tap, box) = parts.value
            let runLoop = CFRunLoopGetCurrent()!
            box.runLoop = runLoop
            let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
            CFRunLoopAddSource(runLoop, source, .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
            started.signal()
            CFRunLoopRun()
        }
        thread.name = "murmur-hotkeys"
        thread.qualityOfService = .userInteractive
        thread.start()
        started.wait()
        state = Running(tap: tap, runLoop: box.runLoop!, handler: handler)
        return true
    }

    public func stop() {
        lock.lock()
        let running = state
        state = nil
        lock.unlock()
        guard let running else { return }
        CGEvent.tapEnable(tap: running.tap, enable: false)
        CFMachPortInvalidate(running.tap)
        CFRunLoopStop(running.runLoop)
        // The callback can no longer run once the port is invalidated and the loop stopped.
        running.handler.release()
    }
}

/// Holds a value across a thread boundary when the compiler cannot prove it is safe.
struct UncheckedSendable<Value>: @unchecked Sendable {
    let value: Value
    init(_ value: Value) { self.value = value }
}

/// Written once by the tap thread before it signals, read after the wait.
private final class RunLoopBox: @unchecked Sendable {
    var runLoop: CFRunLoop?
}

/// Called on the tap thread for each event. Converts the event and passes it on.
final class TapHandler: @unchecked Sendable {
    // @unchecked: `tap` is set once before the tap is enabled and only read afterwards.
    private let onInput: @Sendable (RawKeyInput, Int) -> Void
    private let onStatus: @Sendable (TapStatusChange) -> Void
    private var tap: CFMachPort?

    init(onInput: @escaping @Sendable (RawKeyInput, Int) -> Void, onStatus: @escaping @Sendable (TapStatusChange) -> Void) {
        self.onInput = onInput
        self.onStatus = onStatus
    }

    func setTap(_ tap: CFMachPort) { self.tap = tap }

    func handle(type: CGEventType, event: CGEvent) {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            onStatus(.disabledBySystem)
            if let tap {
                CGEvent.tapEnable(tap: tap, enable: true)
                onStatus(.reenabled)
            }
        case .otherMouseDown, .otherMouseUp:
            let button = Int(event.getIntegerValueField(.mouseEventButtonNumber))
            guard let input = Self.mouseInput(type: type, button: button) else { return }
            onInput(input, EventClock.epochMs(eventTimestamp: event.timestamp))
        case .flagsChanged, .keyDown, .keyUp:
            let keyCode = Int(event.getIntegerValueField(.keyboardEventKeycode))
            let flags = event.flags.rawValue
            let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
            guard let input = Self.input(type: type, keyCode: keyCode, flags: flags, isRepeat: isRepeat) else { return }
            onInput(input, EventClock.epochMs(eventTimestamp: event.timestamp))
        default:
            return
        }
    }

    static func mouseInput(type: CGEventType, button: Int) -> RawKeyInput? {
        guard MouseButtons.allowed.contains(button) else { return nil }
        switch type {
        case .otherMouseDown: return .mouseDown(button: button)
        case .otherMouseUp: return .mouseUp(button: button)
        default: return nil
        }
    }

    static func input(type: CGEventType, keyCode: Int, flags: UInt64, isRepeat: Bool) -> RawKeyInput? {
        switch type {
        case .flagsChanged:
            guard let isDown = KeyCodes.isModifierDown(keyCode: keyCode, flags: flags) else { return nil }
            return .modifier(keyCode: keyCode, isDown: isDown)
        case .keyDown:
            return .keyDown(keyCode: keyCode, modifiers: KeyCodes.modifiers(from: flags), isRepeat: isRepeat)
        case .keyUp:
            return .keyUp(keyCode: keyCode)
        default:
            return nil
        }
    }
}

/// C callback for the tap. Always returns the event unchanged (the tap is listen-only).
private func eventTapCallback(
    proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    if let userInfo {
        Unmanaged<TapHandler>.fromOpaque(userInfo).takeUnretainedValue().handle(type: type, event: event)
    }
    return Unmanaged.passUnretained(event)
}
