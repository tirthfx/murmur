import Foundation
import XCTest

@testable import MurmurHelperCore

private final class FakeApps: AppsSource, @unchecked Sendable {
    private let lock = NSLock()
    private var front: FrontAppInfo?
    private var title: String?
    private var page: SiteRead = .notBrowser
    private(set) var siteReads = 0
    let installed: [InstalledApp]
    init(front: FrontAppInfo?, installed: [InstalledApp] = []) {
        self.front = front
        self.installed = installed
    }
    func frontApp() -> FrontAppInfo? { lock.withLock { front } }
    func windowTitle(of app: FrontAppInfo) -> String? { lock.withLock { title } }
    func site(of app: FrontAppInfo) -> SiteRead {
        lock.withLock {
            siteReads += 1
            return page
        }
    }
    func installedApps() -> [InstalledApp] { installed }
    func set(_ app: FrontAppInfo?) { lock.withLock { front = app } }
    func setPage(_ read: SiteRead, title newTitle: String?) {
        lock.withLock {
            page = read
            title = newTitle
        }
    }
    var reads: Int { lock.withLock { siteReads } }
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

    func testSendsTheSiteOfABrowserWhenTheTabChanges() {
        let apps = FakeApps(front: safari)
        apps.setPage(.site(SiteInfo(host: "news.example.com", path: "/today")), title: "News")
        let events = EmittedEvents()
        // A long site interval: only the title change makes it read again.
        let controller = FocusWatchController(
            source: apps, emit: { events.append($0) }, pollSeconds: 0.01, sitePolls: 10_000)
        _ = watch(controller, true)
        waitForReplies(events, count: 1)
        XCTAssertEqual(events.all.first?.payload["siteStatus"], .string("ok"))
        XCTAssertEqual(
            events.all.first?.payload["site"],
            .object(["host": .string("news.example.com"), "path": .string("/today")]))
        apps.setPage(.site(SiteInfo(host: "video.example.com", path: "/")), title: "Video")
        waitForReplies(events, count: 2)
        XCTAssertEqual(events.all.last?.payload["site"]?.objectValue?["host"], .string("video.example.com"))
        _ = watch(controller, false)
    }

    func testReadsTheSiteAgainOnTheIntervalAndReportsUnreadableBrowsers() {
        let apps = FakeApps(front: safari)
        apps.setPage(.unavailable, title: "Same")
        let events = EmittedEvents()
        let controller = FocusWatchController(
            source: apps, emit: { events.append($0) }, pollSeconds: 0.01, sitePolls: 2)
        _ = watch(controller, true)
        waitForReplies(events, count: 1)
        XCTAssertEqual(events.all.first?.payload["siteStatus"], .string("unavailable"))
        Thread.sleep(forTimeInterval: 0.1)
        XCTAssertGreaterThan(apps.reads, 2)
        XCTAssertEqual(events.all.count, 1)
        _ = watch(controller, false)
    }

    func testDoesNotReadPagesOutsideBrowsers() {
        let apps = FakeApps(front: notes)
        let (controller, events) = make(apps)
        _ = watch(controller, true)
        waitForReplies(events, count: 1)
        Thread.sleep(forTimeInterval: 0.05)
        XCTAssertEqual(events.all.first?.payload["siteStatus"], .string("none"))
        XCTAssertEqual(apps.reads, 1)
        _ = watch(controller, false)
    }

    func testKeepsOnlyTheHostAndPathOfAnAddress() {
        XCTAssertEqual(
            SiteInfo.from(address: "https://WWW.Example.com/watch?v=secret#t=1"),
            SiteInfo(host: "www.example.com", path: "/watch"))
        XCTAssertEqual(SiteInfo.from(address: "http://example.com"), SiteInfo(host: "example.com", path: "/"))
        XCTAssertNil(SiteInfo.from(address: "about:blank"))
        XCTAssertNil(SiteInfo.from(address: "file:///Users/me/notes.html"))
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
