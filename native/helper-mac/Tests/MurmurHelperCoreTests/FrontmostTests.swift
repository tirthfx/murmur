import Foundation
import XCTest

@testable import MurmurHelperCore

final class FrontmostTests: XCTestCase {
    func testTakesTheFirstLookupThatFindsAnApp() {
        XCTAssertEqual(Frontmost.firstPid([{ 42 }, { 7 }]), 42)
        XCTAssertEqual(Frontmost.firstPid([{ nil }, { 0 }, { 7 }]), 7)
        XCTAssertNil(Frontmost.firstPid([{ nil }, { nil }]))
    }
}
