import Foundation
import SwiftUI
import XCTest

@testable import BrownSync

@MainActor
final class SceneLifecycleREDTests: XCTestCase {
    func testFriendsSurfaceTracksTabAndSceneNotChildNavigationVisibility()
        throws
    {
        XCTAssertTrue(
            FriendsSurfaceActivityPolicy.isActive(
                selectedTab: .friends,
                scenePhase: .active
            ),
            "Pushing Friend Detail or Presence must leave the whole Friends tab surface active."
        )
        XCTAssertFalse(
            FriendsSurfaceActivityPolicy.isActive(
                selectedTab: .map,
                scenePhase: .active
            )
        )
        XCTAssertFalse(
            FriendsSurfaceActivityPolicy.isActive(
                selectedTab: .friends,
                scenePhase: .background
            )
        )

        let testFile = URL(fileURLWithPath: #filePath)
        let iosDirectory = testFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let friendsSource = try String(
            contentsOf: iosDirectory.appendingPathComponent(
                "Sources/BrownSync/Features/Social/FriendsView.swift"
            ),
            encoding: .utf8
        )
        XCTAssertFalse(
            friendsSource.contains(".onDisappear { model.deactivate() }"),
            "A child push makes the root list disappear without deactivating the Friends tab."
        )
    }

    func testAdmissionInAlreadyActiveSceneRequiresForegroundResume() {
        let identity = AdmittedIdentity(
            id: Phase3Fixture.me,
            email: "bear@brown.edu"
        )
        XCTAssertTrue(
            AuthForegroundActivationPolicy.shouldResume(
                state: .admitted(identity),
                scenePhase: .active
            )
        )
        XCTAssertFalse(
            AuthForegroundActivationPolicy.shouldResume(
                state: .authenticating,
                scenePhase: .active
            )
        )
        XCTAssertFalse(
            AuthForegroundActivationPolicy.shouldResume(
                state: .admitted(identity),
                scenePhase: .background
            )
        )
    }

    func testNewActiveSupersedesGatedBackgroundBeforeLateStop() async {
        let sequencer = SceneLifecycleTaskSequencer()
        let gate = Phase3AsyncGate()
        let log = Phase3CallLog()

        sequencer.submit { isCurrent in
            await log.append("background.suspend")
            await gate.wait()
            guard isCurrent() else {
                await log.append("background.stale")
                return
            }
            await log.append("background.stop")
        }
        await gate.waitForWaiterCount(1)
        sequencer.submit { isCurrent in
            guard isCurrent() else { return }
            await log.append("active.resume")
        }
        await gate.releaseAll()
        await sequencer.waitForIdle()

        let entries = await log.values()
        XCTAssertEqual(
            entries,
            [
                "background.suspend",
                "background.stale",
                "active.resume",
            ]
        )
    }

    func testNewBackgroundSupersedesGatedActiveBeforeLateResume() async {
        let sequencer = SceneLifecycleTaskSequencer()
        let gate = Phase3AsyncGate()
        let log = Phase3CallLog()

        sequencer.submit { isCurrent in
            await log.append("active.prepare")
            await gate.wait()
            guard isCurrent() else {
                await log.append("active.stale")
                return
            }
            await log.append("active.resume")
        }
        await gate.waitForWaiterCount(1)
        sequencer.submit { isCurrent in
            guard isCurrent() else { return }
            await log.append("background.suspend")
            guard isCurrent() else { return }
            await log.append("background.stop")
        }
        await gate.releaseAll()
        await sequencer.waitForIdle()

        let entries = await log.values()
        XCTAssertEqual(
            entries,
            [
                "active.prepare",
                "active.stale",
                "background.suspend",
                "background.stop",
            ]
        )
    }
}
