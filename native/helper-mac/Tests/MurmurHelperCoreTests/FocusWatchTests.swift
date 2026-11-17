import Foundation
import XCTest

@testable import MurmurHelperCore

private final class FakeApps: AppsSource, @unchecked Sendable {
    private let lock = NSLock()
    private var front: FrontAppInfo?
    let installed: [InstalledApp]
    init(front: FrontAppInfo?, installed: [InstalledApp] = []) {
        self.front = front
        self.installed = installed
    }
    func frontApp() -> FrontAppInfo? { lock.withLock { front } }
    func installedApps() -> [InstalledApp] { installed }
    func set(_ app: FrontAppInfo?) { lock.withLock { front = app } }
}

final class FocusWatchControllerTests: XCTestCase {
    private let notes = FrontAppInfo(bundleId: "com.apple.Notes", name: "Notes", pid: 10)
    private let safari = FrontAppInfo(bundleId: "com.apple.Safari", name: "Safari", pid: 11)

    private func make(_ source: FakeApps) -> (FocusWatchController, EmittedEvents) {
        let events = EmittedEvents()
        return (FocusWatchController(source: source, emit: { events.append($0) }, pollSeconds: 0.01), events)
    }

    private func watch(_ controller: FocusWatchController, _ enabled: Bool) -> Envelope {
        controller.handle(id: "f-1", type: "focus.watch", payload: ["enabled": .bool(enabled)])
    }

    func testSendsTheFrontAppAtOnceAndThenOnlyOnChange() {
        let apps = FakeApps(front: notes)
        let (controller, events) = make(apps)
        XCTAssertEqual(watch(controller, true).payload["result"]?.objectValue?["watching"], .bool(true))
        waitForReplies(events, count: 1)
        Thread.sleep(forTimeInterval: 0.08)
        XCTAssertEqual(events.all.count, 1)
        XCTAssertEqual(events.all.first?.type, "focus.app")
        XCTAssertEqual(events.all.first?.payload["bundleId"], .string("com.apple.Notes"))
        apps.set(safari)
        waitForReplies(events, count: 2)
        XCTAssertEqual(events.all.last?.payload["name"], .string("Safari"))
        XCTAssertEqual(events.all.last?.payload["pid"], .int(11))
    }

    func testStopsWhenTurnedOff() {
        let apps = FakeApps(front: notes)
        let (controller, events) = make(apps)
        _ = watch(controller, true)
        waitForReplies(events, count: 1)
        XCTAssertEqual(watch(controller, false).payload["result"]?.objectValue?["watching"], .bool(false))
        Thread.sleep(forTimeInterval: 0.03)
        apps.set(safari)
        Thread.sleep(forTimeInterval: 0.08)
        XCTAssertEqual(events.all.count, 1)
    }

    func testRefusesAWatchWithoutEnabled() {
        let (controller, _) = make(FakeApps(front: nil))
        let reply = controller.handle(id: "f-1", type: "focus.watch", payload: [:])
        XCTAssertEqual(reply.payload["ok"], .bool(false))
    }

    func testListsInstalledAppsOncePerBundleIdByName() {
        let apps = FakeApps(
            front: nil,
            installed: [
                InstalledApp(bundleId: "com.apple.Safari", name: "Safari"),
                InstalledApp(bundleId: "com.apple.Notes", name: "notes"),
                InstalledApp(bundleId: "com.apple.Safari", name: "Safari copy"),
                InstalledApp(bundleId: "", name: "Broken"),
            ])
        let (controller, _) = make(apps)
        let reply = controller.handle(id: "f-2", type: "apps.list", payload: [:])
        let list = reply.payload["result"]?.objectValue?["apps"]?.arrayValue ?? []
        XCTAssertEqual(list.compactMap { $0.objectValue?["bundleId"]?.stringValue }, ["com.apple.Notes", "com.apple.Safari"])
    }

    func testTheRouterPassesFocusRequestsOn() {
        let events = EmittedEvents()
        var router = MessageRouter(
            permissions: FakePermissionProvider(),
            focus: FocusWatchController(source: FakeApps(front: nil), emit: { events.append($0) }),
            uptimeMs: { 0 })
        _ = router.handle(line: line(#"{"id":"a","type":"hello.ack","payload":{"accepted":true,"protocolVersion":1,"appVersion":"0"}}"#))
        let replies = router.handle(line: line(#"{"id":"b","type":"apps.list","payload":{}}"#))
        XCTAssertEqual(replies.first?.payload["ok"], .bool(true))
    }
}
