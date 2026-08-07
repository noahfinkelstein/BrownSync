import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class FriendsLifecycleREDTests: XCTestCase {
    func testSlowOldUserFetchCannotReplaceNewUsersCache() async {
        let transport = Phase3SocialTransportRecorder(
            rows: [.profiles: profileJSON()]
        )
        await transport.blockNextSelection(.profiles)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let dependencies = makeDependencies(
            transport: transport,
            cache: cache
        )
        let model = FriendsViewModel(
            currentUserID: Phase3Fixture.me,
            dependencies: dependencies,
            places: Phase3PlaceRepositoryFake()
        )

        let oldUserRefresh = Task { await model.activate() }
        await transport.waitForSelectionCount(1)
        await cache.setCurrentUserID(Phase3Fixture.other)
        await transport.releaseSelection(.profiles)
        await oldUserRefresh.value

        let snapshot = await cache.snapshot(
            at: await dependencies.timeSource.now()
        )
        XCTAssertEqual(snapshot, .empty)
        let otherGeneration = await cache.protectionGeneration(
            for: Phase3Fixture.other
        )
        let currentGeneration =
            await cache.currentProtectionGeneration()
        XCTAssertEqual(
            otherGeneration,
            currentGeneration
        )
    }

    func testDeactivateCancelsGatedActivationAndPurgesBeforeItCanReacquire()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [.profiles: profileJSON()]
        )
        await transport.blockNextSelection(.profiles)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let channel = Phase3RealtimeChannelFake(log: Phase3CallLog())
        let dependencies = makeDependencies(
            transport: transport,
            cache: cache,
            channel: channel
        )
        let model = FriendsViewModel(
            currentUserID: Phase3Fixture.me,
            dependencies: dependencies,
            places: Phase3PlaceRepositoryFake()
        )

        let activation = Task { await model.activate() }
        await transport.waitForSelectionCount(1)
        let deactivation = model.deactivate()
        await transport.releaseSelection(.profiles)
        await activation.value
        await deactivation.value

        let snapshot = await cache.snapshot(
            at: await dependencies.timeSource.now()
        )
        XCTAssertEqual(snapshot, .empty)
        let subscriptions = await channel.numberOfSubscriptions()
        XCTAssertEqual(subscriptions, 0)
    }

    func testDeactivateSynchronouslyClearsPublishedProtectedStateBeforeAsyncCleanupFinishes()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: populatedSocialRows()
        )
        let cache = SensitiveCache(currentUserID: Phase3Fixture.other)
        let channel = Phase3RealtimeChannelFake(log: Phase3CallLog())
        let dependencies = makeDependencies(
            transport: transport,
            cache: cache,
            channel: channel
        )
        let model = FriendsViewModel(
            currentUserID: Phase3Fixture.other,
            dependencies: dependencies,
            places: Phase3PlaceRepositoryFake()
        )
        model.friendSearch = "old"
        await model.activate()
        XCTAssertFalse(model.snapshot.profiles.isEmpty)
        XCTAssertEqual(
            model.matchingProfiles.map(\.id),
            [Phase3Fixture.me]
        )
        model.errorMessage = "old protected error"
        model.confirmationMessage = "old protected confirmation"

        await channel.blockNextRemove()
        let deactivation = model.deactivate()

        XCTAssertEqual(model.snapshot, .empty)
        XCTAssertTrue(model.matchingProfiles.isEmpty)
        XCTAssertEqual(model.friendSearch, "")
        XCTAssertNil(model.errorMessage)
        XCTAssertNil(model.confirmationMessage)

        await channel.waitForRemoveCount(1)
        await channel.releaseRemove()
        await deactivation.value
    }

    func testDeactivatePurgesRetryProfileThenRehydratesExactRetryOnReactivation()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [
                .profiles: profileJSON(
                    id: Phase3Fixture.friend,
                    handle: "bruno",
                    displayName: "Bruno Bear"
                ),
                .friendships: "[]",
                .presenceShares: "[]",
                .presenceState: "[]",
            ]
        )
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let dependencies = makeDependencies(
            transport: transport,
            cache: cache
        )
        let model = FriendsViewModel(
            currentUserID: Phase3Fixture.me,
            dependencies: dependencies,
            places: Phase3PlaceRepositoryFake()
        )
        await model.activate()
        await transport.failNextRPC(.blockUser, with: .offline)
        await model.block(Phase3Fixture.profile())
        XCTAssertEqual(
            model.failedPrivacyAction?.unconfirmedAction,
            .blockUser(Phase3Fixture.friend)
        )

        let deactivation = model.deactivate()
        XCTAssertEqual(model.snapshot, .empty)
        XCTAssertNil(model.failedPrivacyAction)
        XCTAssertNil(model.errorMessage)
        await deactivation.value

        await model.activate()
        XCTAssertEqual(
            model.failedPrivacyAction?.unconfirmedAction,
            .blockUser(Phase3Fixture.friend)
        )
        await model.retryFailedPrivacyAction()
        let records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.blockUser, .blockUser])
        XCTAssertNil(model.failedPrivacyAction)
        await model.deactivate().value
    }

    func testConcurrentActivateCallsShareOneFetchAndOneRealtimeLease()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [
                .profiles: "[]",
                .friendships: "[]",
                .presenceShares: "[]",
                .presenceState: "[]",
            ]
        )
        await transport.blockNextSelection(.profiles)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let channel = Phase3RealtimeChannelFake(log: Phase3CallLog())
        let dependencies = makeDependencies(
            transport: transport,
            cache: cache,
            channel: channel
        )
        let model = FriendsViewModel(
            currentUserID: Phase3Fixture.me,
            dependencies: dependencies,
            places: Phase3PlaceRepositoryFake()
        )

        let first = Task { await model.activate() }
        let initialSelectionStarted =
            await transport.waitForSelectionCount(
                1,
                timeout: .seconds(1)
            )
        guard initialSelectionStarted else {
            await cancelAndDrainConcurrentActivation(
                model: model,
                transport: transport,
                tasks: [first]
            )
            return XCTFail(
                "The first activation did not start its snapshot fetch."
            )
        }
        let second = Task { await model.activate() }
        let secondActivationCoalesced =
            await model.waitForCoalescedActivationCount(
                1,
                timeout: .seconds(1)
            )
        guard secondActivationCoalesced else {
            await cancelAndDrainConcurrentActivation(
                model: model,
                transport: transport,
                tasks: [first, second]
            )
            return XCTFail(
                "The second activation did not join the in-flight activation."
            )
        }
        let allSnapshotReadsStarted =
            await transport.waitForSelectionCount(
                SocialTable.allCases.count,
                timeout: .seconds(1)
            )
        guard allSnapshotReadsStarted else {
            await cancelAndDrainConcurrentActivation(
                model: model,
                transport: transport,
                tasks: [first, second]
            )
            return XCTFail(
                "The shared snapshot fetch did not start all four table reads."
            )
        }
        let whileBlocked = await transport.selections()
        XCTAssertEqual(
            Set(whileBlocked),
            Set(SocialTable.allCases),
            "One snapshot fetch starts all four independent table reads."
        )
        for table in SocialTable.allCases {
            XCTAssertEqual(
                whileBlocked.filter { $0 == table }.count,
                1,
                "A concurrent activate call must not start a second \(table.rawValue) read."
            )
        }

        await transport.releaseSelection(.profiles)
        await first.value
        await second.value

        let subscriptions = await channel.numberOfSubscriptions()
        XCTAssertEqual(subscriptions, 1)
        let deactivation = model.deactivate()
        await deactivation.value
    }

    private func cancelAndDrainConcurrentActivation(
        model: FriendsViewModel,
        transport: Phase3SocialTransportRecorder,
        tasks: [Task<Void, Never>]
    ) async {
        tasks.forEach { $0.cancel() }
        let deactivation = model.deactivate()
        await transport.releaseSelection(.profiles)
        for task in tasks {
            await task.value
        }
        await deactivation.value
    }

    func testConcurrentActivationsAfterGatedDeactivationCoalesceAgain()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [
                .profiles: "[]",
                .friendships: "[]",
                .presenceShares: "[]",
                .presenceState: "[]",
            ]
        )
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let channel = Phase3RealtimeChannelFake(log: Phase3CallLog())
        let dependencies = makeDependencies(
            transport: transport,
            cache: cache,
            channel: channel
        )
        let model = FriendsViewModel(
            currentUserID: Phase3Fixture.me,
            dependencies: dependencies,
            places: Phase3PlaceRepositoryFake()
        )
        await model.activate()
        await channel.blockNextRemove()
        let deactivation = model.deactivate()
        await channel.waitForRemoveCount(1)

        let firstReplacement = Task { await model.activate() }
        let secondReplacement = Task { await model.activate() }
        await model.waitForActivationDeactivationWaiterCount(2)
        await channel.releaseRemove()
        await deactivation.value
        await firstReplacement.value
        await secondReplacement.value

        let subscriptions = await channel.numberOfSubscriptions()
        XCTAssertEqual(
            subscriptions,
            2,
            "Both callers released from one deactivation must share the replacement activation."
        )
        await model.deactivate().value
    }

    func testDeactivateDuringInitialRealtimeFetchStopsBeforeLeaseExists()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [
                .profiles: "[]",
                .friendships: "[]",
                .presenceShares: "[]",
                .presenceState: "[]",
            ]
        )
        await transport.blockSelection(
            .presenceState,
            occurrence: 2
        )
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let channel = Phase3RealtimeChannelFake(log: Phase3CallLog())
        let dependencies = makeDependencies(
            transport: transport,
            cache: cache,
            channel: channel
        )
        let model = FriendsViewModel(
            currentUserID: Phase3Fixture.me,
            dependencies: dependencies,
            places: Phase3PlaceRepositoryFake()
        )

        let activation = Task { await model.activate() }
        await transport.waitForSelectionCount(5)
        let stopSequence = await dependencies.realtimeCoordinator
            .currentStopRequestSequence()
        let deactivation = model.deactivate()
        await dependencies.realtimeCoordinator.waitForStopRequest(
            after: stopSequence
        )

        let whileFetchBlocked = await cache.snapshot(
            at: await dependencies.timeSource.now()
        )
        XCTAssertEqual(whileFetchBlocked, .empty)

        await transport.releaseSelection(.presenceState)
        await activation.value
        await deactivation.value
        await channel.waitForRemoveCount(1)
        let afterRelease = await cache.snapshot(
            at: await dependencies.timeSource.now()
        )
        XCTAssertEqual(afterRelease, .empty)
        let subscriptions = await channel.numberOfSubscriptions()
        XCTAssertEqual(subscriptions, 1)
    }

    func testLatePrivacyMutationCannotReloadAfterFriendsDeactivation()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: populatedSocialRows()
        )
        await transport.blockNextRPC(.blockUser)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let dependencies = makeDependencies(
            transport: transport,
            cache: cache
        )
        let model = FriendsViewModel(
            currentUserID: Phase3Fixture.me,
            dependencies: dependencies,
            places: Phase3PlaceRepositoryFake()
        )
        await model.activate()
        let selectionsBeforeMutation = await transport.selections()

        let mutation = Task {
            await model.block(Phase3Fixture.profile())
        }
        await transport.waitForRPCCount(1)
        await model.deactivate().value
        await transport.releaseRPC(.blockUser)
        await mutation.value

        let snapshot = await cache.snapshot(
            at: await dependencies.timeSource.now()
        )
        XCTAssertEqual(snapshot, .empty)
        let selectionsAfterMutation = await transport.selections()
        XCTAssertEqual(
            selectionsAfterMutation,
            selectionsBeforeMutation,
            "A privacy mutation completed after deactivation must not start a post-success reload."
        )
    }

    func testLateShareMutationCannotReloadAfterFriendsDeactivation()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: populatedSocialRows()
        )
        await transport.blockNextRPC(.setPresenceShare)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let dependencies = makeDependencies(
            transport: transport,
            cache: cache
        )
        let model = FriendsViewModel(
            currentUserID: Phase3Fixture.me,
            dependencies: dependencies,
            places: Phase3PlaceRepositoryFake()
        )
        await model.activate()
        let selectionsBeforeMutation = await transport.selections()

        let mutation = Task {
            await model.setShare(with: Phase3Fixture.profile())
        }
        await transport.waitForRPCCount(1)
        await model.deactivate().value
        await transport.releaseRPC(.setPresenceShare)
        await mutation.value

        let snapshot = await cache.snapshot(
            at: await dependencies.timeSource.now()
        )
        XCTAssertEqual(snapshot, .empty)
        let selectionsAfterMutation = await transport.selections()
        XCTAssertEqual(
            selectionsAfterMutation,
            selectionsBeforeMutation,
            "A share mutation completed after deactivation must not start a post-success reload."
        )

        await model.activate()
        let selectionsAfterReactivation = await transport.selections()
        XCTAssertGreaterThan(
            selectionsAfterReactivation.count,
            selectionsBeforeMutation.count,
            "Returning to Friends must remain the reconciliation point for a mutation completed while inactive."
        )
        let reconciled = await cache.snapshot(
            at: await dependencies.timeSource.now()
        )
        XCTAssertFalse(reconciled.profiles.isEmpty)
        await model.deactivate().value
    }

    func testInactiveFriendsSurfaceRejectsNewMutationAndRefreshWork()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: populatedSocialRows()
        )
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let dependencies = makeDependencies(
            transport: transport,
            cache: cache
        )
        let model = FriendsViewModel(
            currentUserID: Phase3Fixture.me,
            dependencies: dependencies,
            places: Phase3PlaceRepositoryFake()
        )
        await model.activate()
        await model.deactivate().value
        let selectionsWhileInactive = await transport.selections()

        await model.setShare(with: Phase3Fixture.profile())
        await model.block(Phase3Fixture.profile())
        await model.refresh()

        let records = await transport.records()
        XCTAssertTrue(
            records.isEmpty,
            "A mutation that begins after deactivation must not reach the server."
        )
        let selectionsAfterCalls = await transport.selections()
        XCTAssertEqual(
            selectionsAfterCalls,
            selectionsWhileInactive,
            "A stable inactive lifecycle generation must not authorize a reload."
        )
        let snapshot = await cache.snapshot(
            at: await dependencies.timeSource.now()
        )
        XCTAssertEqual(snapshot, .empty)
    }

    func testGatedOldMonitorCannotPublishIntoReplacementLifecycle()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: populatedSocialRows()
        )
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let dependencies = makeDependencies(
            transport: transport,
            cache: cache
        )
        let model = FriendsViewModel(
            currentUserID: Phase3Fixture.me,
            dependencies: dependencies,
            places: Phase3PlaceRepositoryFake()
        )
        await model.activate()
        model.gateNextMonitorRefresh()
        let oldGeneration = await model.waitForGatedMonitorRefresh()

        await transport.setRows(
            profileJSON(
                handle: "new-user",
                displayName: "New User"
            ),
            for: .profiles
        )
        await model.deactivate().value
        await model.activate()
        let replacementGeneration =
            model.currentLifecycleGenerationForTesting()
        XCTAssertNotEqual(replacementGeneration, oldGeneration)
        await model.waitForMonitorRefreshCompletion(
            lifecycleGeneration: replacementGeneration
        )
        XCTAssertEqual(
            model.snapshot.profiles.first?.handle,
            "new-user"
        )

        model.releaseGatedMonitorRefresh()
        await model.waitForMonitorRefreshCompletion(
            lifecycleGeneration: oldGeneration
        )

        XCTAssertEqual(
            model.snapshot.profiles.first?.handle,
            "new-user",
            "The cancelled old monitor must not publish its captured snapshot into the replacement surface lifecycle."
        )
        let cached = await cache.snapshot(
            at: await dependencies.timeSource.now()
        )
        XCTAssertEqual(cached.profiles.first?.handle, "new-user")
        await model.deactivate().value
    }

    private func makeDependencies(
        transport: Phase3SocialTransportRecorder,
        cache: SensitiveCache,
        channel: Phase3RealtimeChannelFake? = nil
    ) -> SocialDependencies {
        let repository = SupabaseSocialRepository(transport: transport)
        let time = Phase3ManualTimeSource()
        return SocialDependencies(
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
                channel: channel
                    ?? Phase3RealtimeChannelFake(log: Phase3CallLog()),
                reconciliationTicker: Phase3ReconciliationTickerFake(),
                timeSource: time
            ),
            timeSource: time,
            locationProvider: Phase3LocationProviderFake(),
            placeSnapper: emptySnapper()
        )
    }

    private func emptySnapper() -> CampusPlaceSnapper {
        let buildings = try! CampusBuildings.decode(
            Data(#"{"type":"FeatureCollection","features":[]}"#.utf8)
        )
        return CampusPlaceSnapper(buildings: buildings)
    }

    private func profileJSON(
        id: UUID = Phase3Fixture.me,
        handle: String = "old-user",
        displayName: String = "Old User"
    ) -> String {
        """
        [{
          "id":"\(id.uuidString.lowercased())",
          "handle":"\(handle)",
          "display_name":"\(displayName)",
          "avatar_url":null,
          "class_year":null,
          "concentration":null,
          "bio":null,
          "created_at":"2027-01-15T08:00:00Z",
          "updated_at":"2027-01-15T08:00:00Z"
        }]
        """
    }

    private func populatedSocialRows() -> [SocialTable: String] {
        [
            .profiles: profileJSON(),
            .friendships: "[]",
            .presenceShares: "[]",
            .presenceState: "[]",
        ]
    }
}

@MainActor
private struct Phase3LocationProviderFake: LocationProviding {
    func requestCurrentLocation() async throws -> CampusLocationReading {
        throw CoreLocationProviderError.locationUnavailable
    }
}
