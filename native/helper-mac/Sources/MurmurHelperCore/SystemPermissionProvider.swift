import ApplicationServices
import AVFoundation
import CoreGraphics
import IOKit.hid

/// Real macOS implementation. Each status call is read-only. Each request call hands the
/// question to the OS and returns without waiting for the answer; the app reads the new
/// status the next time it checks (it does so whenever the Hub regains focus).
public struct SystemPermissionProvider: PermissionProvider {
    public init() {}

    public func status(of kind: PermissionKind) -> PermissionStatus {
        switch kind {
        case .microphone:
            return Self.microphoneStatus()
        case .accessibility:
            // The OS only says whether the app is trusted, not whether it was asked.
            return AXIsProcessTrusted() ? .granted : .denied
        case .inputMonitoring:
            return Self.map(hidAccess: IOHIDCheckAccess(kIOHIDRequestTypeListenEvent))
        case .screenRecording:
            // The preflight call has no "not asked" answer, so a refusal stays unknown.
            return CGPreflightScreenCaptureAccess() ? .granted : .unknown
        }
    }

    public func request(_ kind: PermissionKind) -> PermissionStatus {
        switch kind {
        case .microphone:
            if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
                AVCaptureDevice.requestAccess(for: .audio) { _ in }
            }
        case .accessibility:
            // The literal is the value of kAXTrustedCheckOptionPrompt, which Swift 6 will not
            // let us read because it is a mutable global.
            let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        case .inputMonitoring:
            if IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) == kIOHIDAccessTypeUnknown {
                _ = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
            }
        case .screenRecording:
            // Never requested in this version. Reading the status is all that is allowed.
            break
        }
        return status(of: kind)
    }

    static func microphoneStatus() -> PermissionStatus {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return .granted
        case .notDetermined: return .notDetermined
        // Restricted means a policy blocks it, which the user cannot change here.
        case .denied, .restricted: return .denied
        @unknown default: return .unknown
        }
    }

    static func map(hidAccess: IOHIDAccessType) -> PermissionStatus {
        switch hidAccess {
        case kIOHIDAccessTypeGranted: return .granted
        case kIOHIDAccessTypeDenied: return .denied
        case kIOHIDAccessTypeUnknown: return .notDetermined
        default: return .unknown
        }
    }
}
