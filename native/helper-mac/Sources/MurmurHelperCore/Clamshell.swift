import Foundation
import IOKit

/// The lid of a laptop (roadmap M2 epic 7). Read from the power manager; nil on a Mac without
/// a lid or when it cannot be read. Needs no permission.
public enum Clamshell {
    public static func isClosed() -> Bool? {
        let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"))
        guard service != 0 else { return nil }
        defer { IOObjectRelease(service) }
        let value = IORegistryEntryCreateCFProperty(
            service, "AppleClamshellState" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
        return value as? Bool
    }
}
