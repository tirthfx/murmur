import Foundation
import XCTest

@testable import MurmurHelperCore

final class ChromiumAccessibilityTests: XCTestCase {
    func testRecognisesElectronAndChromiumApps() {
        XCTAssertTrue(ChromiumAccessibility.isChromium(frameworks: ["Electron Framework.framework", "Squirrel.framework"]))
        XCTAssertTrue(ChromiumAccessibility.isChromium(frameworks: ["Google Chrome Framework.framework"]))
    }

    func testLeavesOtherAppsAlone() {
        XCTAssertFalse(ChromiumAccessibility.isChromium(frameworks: []))
        XCTAssertFalse(ChromiumAccessibility.isChromium(frameworks: ["Sparkle.framework", "WebKit.framework"]))
    }

    func testAsksEachAppOnlyOnce() {
        let accessibility = ChromiumAccessibility()
        // An app with no bundle is never Chromium, and a second call is skipped either way.
        XCTAssertFalse(accessibility.enableIfNeeded(pid: 99_999, bundleURL: nil))
        XCTAssertFalse(accessibility.enableIfNeeded(pid: 99_999, bundleURL: nil))
    }
}
