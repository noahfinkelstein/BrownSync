import Foundation
import XCTest

@testable import BrownSync

final class SensitiveCacheREDTests: XCTestCase {
    func testFreshCacheInstanceCannotRecoverSensitiveState() async {
        let time = PresenceTime(
            wallClock: Phase3Fixture.baseDate,
            monotonic: .zero
        )
        let first = SensitiveCache(currentUserID: Phase3Fixture.me)
        await first.replace(Phase3Fixture.snapshot(), at: time)
        let firstSnapshot = await first.snapshot(at: time)
        XCTAssertFalse(firstSnapshot.presence.isEmpty)

        let fresh = SensitiveCache(currentUserID: Phase3Fixture.me)

        let freshSnapshot = await fresh.snapshot(at: time)
        XCTAssertEqual(freshSnapshot, .empty)
    }

    func testSnapshotAndVisiblePresenceReplacementAreAtomic() async {
        let time = PresenceTime(
            wallClock: Phase3Fixture.baseDate,
            monotonic: .zero
        )
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        await cache.replace(Phase3Fixture.snapshot(), at: time)
        let replacement = Phase3Fixture.presence(
            userID: Phase3Fixture.other,
            placeID: "main-green"
        )

        await cache.replaceVisiblePresence([replacement], at: time)

        let snapshot = await cache.snapshot(at: time)
        XCTAssertEqual(snapshot.profiles, [Phase3Fixture.profile()])
        XCTAssertEqual(snapshot.friendships, [Phase3Fixture.friendship()])
        XCTAssertEqual(snapshot.shares, [Phase3Fixture.share()])
        XCTAssertEqual(snapshot.presence, [replacement])
        XCTAssertFalse(
            snapshot.presence.contains {
                $0.userID == Phase3Fixture.friend
            },
            "Authoritative replacement must not merge stale rows."
        )
    }

    func testEarliestExpiryIsScheduledAndRowsNeverRenderAtExpiry()
        async
    {
        let initial = PresenceTime(
            wallClock: Phase3Fixture.baseDate,
            monotonic: .zero
        )
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let first = Phase3Fixture.presence(
            userID: Phase3Fixture.friend,
            expiresIn: 5
        )
        let second = Phase3Fixture.presence(
            userID: Phase3Fixture.other,
            placeID: "main-green",
            expiresIn: 10
        )
        await cache.replaceVisiblePresence([first, second], at: initial)

        let firstExpiry = await cache.nextPresenceExpiry()
        XCTAssertEqual(
            firstExpiry,
            Phase3Fixture.baseDate.addingTimeInterval(5)
        )

        let atFirstExpiry = PresenceTime(
            wallClock: Phase3Fixture.baseDate.addingTimeInterval(5),
            monotonic: .seconds(5)
        )
        let afterFirstExpiry = await cache.visiblePresence(
            at: atFirstExpiry
        )
        XCTAssertEqual(afterFirstExpiry, [second])
        let secondExpiry = await cache.nextPresenceExpiry()
        XCTAssertEqual(
            secondExpiry,
            Phase3Fixture.baseDate.addingTimeInterval(10)
        )

        let atSecondExpiry = PresenceTime(
            wallClock: Phase3Fixture.baseDate.addingTimeInterval(10),
            monotonic: .seconds(10)
        )
        let afterSecondExpiry = await cache.visiblePresence(
            at: atSecondExpiry
        )
        XCTAssertTrue(afterSecondExpiry.isEmpty)
        let noExpiry = await cache.nextPresenceExpiry()
        XCTAssertNil(noExpiry)
    }

    func testVisibleFriendPresenceExpiresAtSixtySecondStaleBound()
        async
    {
        let initial = PresenceTime(
            wallClock: Phase3Fixture.baseDate,
            monotonic: .zero
        )
        let cache = SensitiveCache(
            currentUserID: Phase3Fixture.me,
            maximumFriendPresenceStaleness: .seconds(60)
        )
        let own = Phase3Fixture.presence(
            userID: Phase3Fixture.me,
            expiresIn: 600
        )
        let friend = Phase3Fixture.presence(expiresIn: 600)
        await cache.replaceVisiblePresence([own, friend], at: initial)

        let beforeBound = PresenceTime(
            wallClock: Phase3Fixture.baseDate.addingTimeInterval(59),
            monotonic: .seconds(59)
        )
        let beforeBoundPresence = await cache.visiblePresence(
            at: beforeBound
        )
        XCTAssertEqual(
            Set(beforeBoundPresence.map(\.userID)),
            [Phase3Fixture.me, Phase3Fixture.friend]
        )

        let atBound = PresenceTime(
            wallClock: Phase3Fixture.baseDate.addingTimeInterval(60),
            monotonic: .seconds(60)
        )
        let atBoundPresence = await cache.visiblePresence(at: atBound)
        XCTAssertEqual(
            atBoundPresence.map(\.userID),
            [Phase3Fixture.me],
            "A friend row may never outlive the 60-second reconciliation bound."
        )
    }

    func testOwnExpiredGhostSentinelPersistsOnlyAsPrivacyState() async {
        let time = PresenceTime(
            wallClock: Phase3Fixture.baseDate,
            monotonic: .zero
        )
        let sentinel = PresenceState(
            userID: Phase3Fixture.me,
            placeID: nil,
            status: nil,
            note: nil,
            ghost: true,
            updatedAt: Phase3Fixture.baseDate,
            expiresAt: Phase3Fixture.baseDate
        )
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)

        await cache.replaceVisiblePresence([sentinel], at: time)

        let visible = await cache.visiblePresence(at: time)
        XCTAssertEqual(visible, [sentinel])
        XCTAssertTrue(visible[0].ghost)
        XCTAssertNil(visible[0].placeID)
        let nextExpiry = await cache.nextPresenceExpiry()
        XCTAssertNil(nextExpiry)
    }

    func testShareGhostClearAndSpecificExpiryPurgeOnlyRelevantState()
        async
    {
        let time = PresenceTime(
            wallClock: Phase3Fixture.baseDate,
            monotonic: .zero
        )
        let own = Phase3Fixture.presence(
            userID: Phase3Fixture.me,
            expiresIn: 600
        )
        let friend = Phase3Fixture.presence(expiresIn: 600)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        await cache.replace(
            Phase3Fixture.snapshot(presence: [own, friend]),
            at: time
        )

        await cache.purge(
            reason: .shareRevoked(viewerID: Phase3Fixture.friend)
        )
        var snapshot = await cache.snapshot(at: time)
        XCTAssertTrue(snapshot.shares.isEmpty)
        XCTAssertEqual(
            Set(snapshot.presence.map(\.userID)),
            [Phase3Fixture.me, Phase3Fixture.friend],
            "Revoking an outbound share must not erase an independently shared inbound row."
        )

        await cache.purge(reason: .ghostEnabled)
        snapshot = await cache.snapshot(at: time)
        XCTAssertEqual(snapshot.presence.map(\.userID), [Phase3Fixture.friend])

        await cache.replaceVisiblePresence([own, friend], at: time)
        await cache.purge(reason: .presenceCleared)
        snapshot = await cache.snapshot(at: time)
        XCTAssertEqual(snapshot.presence.map(\.userID), [Phase3Fixture.friend])

        await cache.purge(
            reason: .presenceExpired(userID: Phase3Fixture.friend)
        )
        snapshot = await cache.snapshot(at: time)
        XCTAssertTrue(snapshot.presence.isEmpty)
    }

    func testBackgroundAndAuthLossPurgeEverythingImmediately() async {
        let time = PresenceTime(
            wallClock: Phase3Fixture.baseDate,
            monotonic: .zero
        )
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)

        await cache.replace(Phase3Fixture.snapshot(), at: time)
        await cache.purge(reason: .sceneBackgrounded)
        var snapshot = await cache.snapshot(at: time)
        XCTAssertEqual(snapshot, .empty)

        await cache.replace(Phase3Fixture.snapshot(), at: time)
        await cache.purge(reason: .authExpired)
        snapshot = await cache.snapshot(at: time)
        XCTAssertEqual(snapshot, .empty)
    }
}
