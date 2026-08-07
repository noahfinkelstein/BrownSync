import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class SocialUXContractREDTests: XCTestCase {
    func testShareDurationsIncludeCalendarMidnightAndAbsoluteSevenDayCap()
        throws
    {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(
            TimeZone(identifier: "America/New_York")
        )
        let now = try XCTUnwrap(
            calendar.date(
                from: DateComponents(
                    year: 2027,
                    month: 3,
                    day: 14,
                    hour: 12
                )
            )
        )
        let nextMidnight = try XCTUnwrap(
            calendar.dateInterval(of: .day, for: now)?.end
        )

        XCTAssertEqual(
            PresenceShareDurationOption.untilLocalMidnight.expiry(
                from: now,
                calendar: calendar
            ),
            nextMidnight
        )
        XCTAssertEqual(
            PresenceShareDurationOption.sevenDays.expiry(
                from: now,
                calendar: calendar
            ).timeIntervalSince(now),
            7 * 24 * 60 * 60
        )
        XCTAssertEqual(
            Set(PresenceShareDurationOption.allCases),
            [.fourHours, .twelveHours, .untilLocalMidnight, .sevenDays]
        )
    }

    func testRosterContainsExactlyActiveOutboundViewersAndCanonicalPlaceName()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [
                .profiles: profilesJSON(),
                .friendships: "[]",
                .presenceShares: sharesJSON(),
                .presenceState: ownActivePresenceJSON(),
            ]
        )
        let model = makeModel(
            transport: transport,
            places: [
                PublicPlace(
                    id: "rockefeller-library",
                    name: "Rockefeller Library",
                    aliases: ["The Rock"],
                    kind: "library",
                    address: nil,
                    latitude: 41.8,
                    longitude: -71.4
                )
            ]
        )

        await model.activate()

        XCTAssertEqual(
            model.activeOutboundShares.map(\.profile.id),
            [Phase3Fixture.friend]
        )
        XCTAssertEqual(
            model.placeName(for: "rockefeller-library"),
            "Rockefeller Library"
        )
        XCTAssertEqual(
            model.placeName(for: "unknown-place"),
            "unknown place"
        )
    }

    func testRosterIsEmptyWithoutActiveNonGhostOwnPresence()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [
                .profiles: profilesJSON(),
                .friendships: "[]",
                .presenceShares: sharesJSON(),
                .presenceState: "[]",
            ]
        )
        let model = makeModel(transport: transport)

        await model.activate()

        XCTAssertTrue(
            model.activeOutboundShares.isEmpty,
            "A consent row alone must not claim that anyone can see a place now."
        )
    }

    func testFriendDetailFocusesOnlyItsUnconfirmedPrivacyError() {
        XCTAssertTrue(
            FriendDetailAccessibilityPolicy.shouldFocusError(
                message: "Server did not confirm the block.",
                isPrivacyActionUnconfirmed: true
            )
        )
        XCTAssertFalse(
            FriendDetailAccessibilityPolicy.shouldFocusError(
                message: "A different surface failed.",
                isPrivacyActionUnconfirmed: false
            )
        )
        XCTAssertFalse(
            FriendDetailAccessibilityPolicy.shouldFocusError(
                message: nil,
                isPrivacyActionUnconfirmed: true
            )
        )
    }

    func testPresenceInitialLoadErrorPriorityPreservesPrivacyInstructionOrUsesOfflineFallback() {
        XCTAssertEqual(
            PresenceInitialLoadErrorPolicy.messageAfterPlaceLoadFailure(
                existingMessage:
                    "Another privacy change is still unconfirmed. Return to Friends to retry that exact action."
            ),
            "Another privacy change is still unconfirmed. Return to Friends to retry that exact action."
        )
        XCTAssertEqual(
            PresenceInitialLoadErrorPolicy.messageAfterPlaceLoadFailure(
                existingMessage: nil as String?
            ),
            "Place search is offline. Location suggestions may still work."
        )
    }

    func testSuccessfulMutationThenFailedRefetchRemainsConfirmed()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [
                .profiles: profilesJSON(),
                .friendships: "[]",
                .presenceShares: "[]",
                .presenceState: "[]",
            ]
        )
        let model = makeModel(transport: transport)
        await model.activate()
        await transport.failNextSelect(.profiles, with: .offline)

        await model.requestFriend(Phase3Fixture.profile())

        XCTAssertEqual(
            model.confirmationMessage,
            "Change confirmed by the server."
        )
        XCTAssertEqual(
            model.errorMessage,
            "The change was confirmed, but the latest Friends data could not be refreshed."
        )
        let records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.requestFriend])
    }

    func testFailedBlockRetainsExactExplicitRetryAndLocalHide()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [
                .profiles: profilesJSON(),
                .friendships: acceptedFriendshipJSON(),
                .presenceShares: "[]",
                .presenceState: "[]",
            ]
        )
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let model = makeModel(transport: transport, cache: cache)
        await model.activate()
        await transport.failNextRPC(.blockUser, with: .offline)
        let profile = Phase3Fixture.profile()

        await model.block(profile)

        XCTAssertEqual(
            model.failedPrivacyAction?.label,
            "Retry blocking user"
        )
        let hidden = await cache.snapshot(
            at: PresenceTime(
                wallClock: Phase3Fixture.baseDate,
                monotonic: .zero
            )
        )
        XCTAssertFalse(hidden.profiles.contains { $0.id == profile.id })

        await model.refresh()
        XCTAssertEqual(
            model.failedPrivacyAction?.label,
            "Retry blocking user"
        )
        let stillHidden = await cache.snapshot(
            at: PresenceTime(
                wallClock: Phase3Fixture.baseDate,
                monotonic: .zero
            )
        )
        XCTAssertFalse(
            stillHidden.profiles.contains { $0.id == profile.id }
        )

        await model.remove(profile)
        let afterDifferentAction = await transport.records()
        XCTAssertEqual(afterDifferentAction.map(\.function), [.blockUser])
        XCTAssertEqual(
            model.failedPrivacyAction?.label,
            "Retry blocking user"
        )

        await model.retryFailedPrivacyAction()
        let records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.blockUser, .blockUser])
        XCTAssertNil(model.failedPrivacyAction)
    }

    func testUnblockIsExposedOnlyWhenCurrentUserOwnsTheBlock()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [
                .profiles: profilesJSON(),
                .friendships: blockedFriendshipJSON(
                    blockedBy: Phase3Fixture.me
                ),
                .presenceShares: "[]",
                .presenceState: "[]",
            ]
        )
        let model = makeModel(transport: transport)
        await model.activate()
        XCTAssertEqual(
            model.blockedByMeProfiles.map(\.id),
            [Phase3Fixture.friend]
        )

        await model.unblock(Phase3Fixture.profile())
        await transport.setRows(
            blockedFriendshipJSON(blockedBy: Phase3Fixture.friend),
            for: .friendships
        )
        await model.refresh()
        XCTAssertTrue(model.blockedByMeProfiles.isEmpty)
        await model.unblock(Phase3Fixture.profile())

        let records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.unblockUser])
    }

    private func makeModel(
        transport: Phase3SocialTransportRecorder,
        cache: SensitiveCache? = nil,
        places: [PublicPlace] = []
    ) -> FriendsViewModel {
        let cache =
            cache ?? SensitiveCache(currentUserID: Phase3Fixture.me)
        let repository = SupabaseSocialRepository(transport: transport)
        let time = Phase3ManualTimeSource()
        let buildings = try! CampusBuildings.decode(
            Data(#"{"type":"FeatureCollection","features":[]}"#.utf8)
        )
        let dependencies = SocialDependencies(
            repository: repository,
            cache: cache,
            writeCoordinator: PresenceWriteCoordinator(
                repository: repository,
                cache: cache,
                timeSource: time
            ),
            realtimeCoordinator: PresenceRealtimeCoordinator(
                repository: repository,
                cache: cache,
                channel: Phase3RealtimeChannelFake(log: Phase3CallLog()),
                reconciliationTicker: Phase3ReconciliationTickerFake(),
                timeSource: time
            ),
            timeSource: time,
            locationProvider: SocialUXLocationProviderFake(),
            placeSnapper: CampusPlaceSnapper(buildings: buildings)
        )
        return FriendsViewModel(
            currentUserID: Phase3Fixture.me,
            dependencies: dependencies,
            places: Phase3PlaceRepositoryFake(listedPlaces: places),
            now: { Phase3Fixture.baseDate }
        )
    }

    private func profilesJSON() -> String {
        """
        [
          {
            "id":"\(Phase3Fixture.friend.uuidString.lowercased())",
            "handle":"bruno",
            "display_name":"Bruno Bear",
            "avatar_url":null,
            "class_year":2027,
            "concentration":"Computer Science",
            "bio":null,
            "created_at":"2027-01-15T08:00:00Z",
            "updated_at":"2027-01-15T08:00:00Z"
          },
          {
            "id":"\(Phase3Fixture.other.uuidString.lowercased())",
            "handle":"other",
            "display_name":"Other Bear",
            "avatar_url":null,
            "class_year":null,
            "concentration":null,
            "bio":null,
            "created_at":"2027-01-15T08:00:00Z",
            "updated_at":"2027-01-15T08:00:00Z"
          }
        ]
        """
    }

    private func sharesJSON() -> String {
        """
        [
          {
            "owner":"\(Phase3Fixture.me.uuidString.lowercased())",
            "viewer":"\(Phase3Fixture.friend.uuidString.lowercased())",
            "expires_at":"2027-01-15T09:00:00Z",
            "created_at":"2027-01-15T08:00:00Z"
          },
          {
            "owner":"\(Phase3Fixture.me.uuidString.lowercased())",
            "viewer":"\(Phase3Fixture.other.uuidString.lowercased())",
            "expires_at":"2027-01-15T08:00:00Z",
            "created_at":"2027-01-15T07:00:00Z"
          },
          {
            "owner":"\(Phase3Fixture.friend.uuidString.lowercased())",
            "viewer":"\(Phase3Fixture.me.uuidString.lowercased())",
            "expires_at":"2027-01-15T09:00:00Z",
            "created_at":"2027-01-15T08:00:00Z"
          }
        ]
        """
    }

    private func ownActivePresenceJSON() -> String {
        """
        [{
          "user_id":"\(Phase3Fixture.me.uuidString.lowercased())",
          "place_id":"rockefeller-library",
          "status":"studying",
          "note":null,
          "ghost":false,
          "updated_at":"2027-01-15T08:00:00Z",
          "expires_at":"2027-01-15T09:00:00Z"
        }]
        """
    }

    private func acceptedFriendshipJSON() -> String {
        """
        [{
          "requester":"\(Phase3Fixture.me.uuidString.lowercased())",
          "addressee":"\(Phase3Fixture.friend.uuidString.lowercased())",
          "status":"accepted",
          "blocked_by":null,
          "created_at":"2027-01-15T08:00:00Z",
          "responded_at":"2027-01-15T08:00:00Z"
        }]
        """
    }

    private func blockedFriendshipJSON(blockedBy: UUID) -> String {
        """
        [{
          "requester":"\(Phase3Fixture.me.uuidString.lowercased())",
          "addressee":"\(Phase3Fixture.friend.uuidString.lowercased())",
          "status":"blocked",
          "blocked_by":"\(blockedBy.uuidString.lowercased())",
          "created_at":"2027-01-15T08:00:00Z",
          "responded_at":"2027-01-15T08:00:00Z"
        }]
        """
    }
}

@MainActor
private struct SocialUXLocationProviderFake: LocationProviding {
    func requestCurrentLocation() async throws -> CampusLocationReading {
        throw CoreLocationProviderError.locationUnavailable
    }
}
