import Foundation
import XCTest

@testable import MurmurHelperCore

private final class FakeWindows: DetectSource, @unchecked Sendable {
    private let lock = NSLock()
    private var apps: [DetectApp] = []
    private var windowsByPid: [Int: [DetectWindow]] = [:]
    func set(_ app: DetectApp, _ windows: [DetectWindow]) {
        lock.withLock {
            apps.removeAll { $0.pid == app.pid }
            apps.append(app)
            windowsByPid[app.pid] = windows
        }
    }
    func remove(_ app: DetectApp) {
        lock.withLock {
            apps.removeAll { $0.pid == app.pid }
            windowsByPid[app.pid] = nil
        }
    }
    func runningApps() -> [DetectApp] { lock.withLock { apps } }
    func windows(of app: DetectApp, readPages: Bool) -> [DetectWindow] {
        lock.withLock { windowsByPid[app.pid] ?? [] }.map {
            DetectWindow(title: $0.title, address: readPages ? $0.address : nil)
        }
    }
}

final class MeetingDetectionTests: XCTestCase {
    private let zoom = DetectApp(bundleId: "us.zoom.xos", pid: 20)
    private let chrome = DetectApp(bundleId: "com.google.Chrome", pid: 21)

    private let zoomMatcher = DetectMatcher(
        id: "zoom", native: .init(bundleIds: ["us.zoom.xos"], titles: ["Zoom Meeting"]), web: nil)
    private let meetMatcher = DetectMatcher(
        id: "meet", native: nil,
        web: .init(hosts: ["meet.google.com"], path: "^/[a-z]{3}-[a-z]{4}-[a-z]{3}(/|$)", titles: nil))
    private let teamsWeb = DetectMatcher(
        id: "teams", native: nil,
        web: .init(hosts: ["teams.microsoft.com"], path: nil, titles: ["Meeting with"]))

    private func make(_ source: FakeWindows) -> (DetectionController, EmittedEvents) {
        let events = EmittedEvents()
        return (DetectionController(source: source, emit: { events.append($0) }, pollSeconds: 0.01), events)
    }

    func testAZoomMeetingWindowIsACall() {
        let source = FakeWindows()
        let (controller, _) = make(source)
        source.set(zoom, [DetectWindow(title: "Zoom Workplace", address: nil)])
        XCTAssertEqual(controller.active([zoomMatcher]), [])
        source.set(zoom, [DetectWindow(title: "Zoom Workplace", address: nil), DetectWindow(title: "zoom meeting", address: nil)])
        XCTAssertEqual(controller.active([zoomMatcher]), ["zoom"])
    }

    func testOnlyTheVisibleTabOfABrowserCounts() {
        let source = FakeWindows()
        let (controller, _) = make(source)
        // The call is in a background tab: the window shows another page.
        source.set(chrome, [DetectWindow(title: "News", address: "https://news.example.com/today")])
        XCTAssertEqual(controller.active([meetMatcher]), [])
        // The same call in the visible tab.
        source.set(chrome, [DetectWindow(title: "Meet", address: "https://meet.google.com/abc-defg-hij?authuser=0")])
        XCTAssertEqual(controller.active([meetMatcher]), ["meet"])
        // The Meet home page is not a call.
        source.set(chrome, [DetectWindow(title: "Google Meet", address: "https://meet.google.com/landing")])
        XCTAssertEqual(controller.active([meetMatcher]), [])
    }

    func testWithoutAnAddressOnlyAMatcherWithTitleWordsMatches() {
        let source = FakeWindows()
        let (controller, _) = make(source)
        source.set(chrome, [DetectWindow(title: "Meeting with Sam | Microsoft Teams", address: nil)])
        XCTAssertEqual(controller.active([teamsWeb]), ["teams"])
        XCTAssertEqual(controller.active([meetMatcher]), [])
    }

    func testSendsAnEventWhenACallStartsAndEnds() {
        let source = FakeWindows()
        let (controller, events) = make(source)
        let reply = controller.handle(
            id: "d-1", type: "detect.subscribe",
            payload: [
                "enabled": .bool(true),
                "matchers": .array([
                    .object([
                        "id": .string("zoom"),
                        "native": .object(["bundleIds": .array([.string("us.zoom.xos")]), "titles": .array([.string("Zoom Meeting")])]),
                    ])
                ]),
            ])
        XCTAssertEqual(reply.payload["result"]?.objectValue?["watching"], .bool(true))
        Thread.sleep(forTimeInterval: 0.05)
        XCTAssertEqual(events.all.count, 0)
        source.set(zoom, [DetectWindow(title: "Zoom Meeting", address: nil)])
        waitForReplies(events, count: 1)
        XCTAssertEqual(events.all.first?.type, "detect.event")
        XCTAssertEqual(events.all.first?.payload["matcherId"], .string("zoom"))
        XCTAssertEqual(events.all.first?.payload["active"], .bool(true))
        Thread.sleep(forTimeInterval: 0.08)
        XCTAssertEqual(events.all.count, 1, "no repeat while the call goes on")
        source.remove(zoom)
        waitForReplies(events, count: 2)
        XCTAssertEqual(events.all.last?.payload["active"], .bool(false))
        // Nothing sent carries a title or an address.
        XCTAssertEqual(Set(events.all.last?.payload.keys.map { $0 } ?? []), ["matcherId", "active"])
        _ = controller.handle(id: "d-2", type: "detect.subscribe", payload: ["enabled": .bool(false), "matchers": .array([])])
    }

    func testRefusesABadPayloadAndABadMatcher() {
        let (controller, _) = make(FakeWindows())
        let missing = controller.handle(id: "d-3", type: "detect.subscribe", payload: ["enabled": .bool(true)])
        XCTAssertEqual(missing.payload["ok"], .bool(false))
        let badPath = controller.handle(
            id: "d-4", type: "detect.subscribe",
            payload: [
                "enabled": .bool(true),
                "matchers": .array([
                    .object(["id": .string("x"), "web": .object(["hosts": .array([.string("a.com")]), "path": .string("(")])])
                ]),
            ])
        XCTAssertEqual(badPath.payload["ok"], .bool(false))
        let none = controller.handle(id: "d-5", type: "detect.subscribe", payload: ["enabled": .bool(true), "matchers": .array([])])
        XCTAssertEqual(none.payload["result"]?.objectValue?["watching"], .bool(false))
    }
}
