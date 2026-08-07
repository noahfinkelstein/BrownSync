import Foundation
import XCTest

@testable import BrownSync

final class PresenceRealtimeCoordinatorREDTests: XCTestCase {
    func testForegroundRegistersAnyActionBeforeSubscribeAndReconciles()
        async throws
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [.presenceState: presenceJSON()]
        )
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let log = Phase3CallLog()
        let channel = Phase3RealtimeChannelFake(log: log)
        let ticker = Phase3ReconciliationTickerFake()
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceRealtimeCoordinator(
            repository: repository,
            cache: cache,
            channel: channel,
            reconciliationTicker: ticker,
            timeSource: time
        )

        try await coordinator.friendsSurfaceBecameActive()

        let callLog = await log.values()
        XCTAssertEqual(
            callLog,
            ["channel.any-action-stream", "channel.subscribe"]
        )
        let selections = await transport.selections()
        XCTAssertEqual(selections, [.presenceState])
        let visible = await cache.visiblePresence(at: await time.now())
        XCTAssertEqual(visible.map(\.placeID), ["rockefeller-library"])
    }

    func testEveryAnyActionPerformsFullAuthoritativeReplacement()
        async throws
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [.presenceState: presenceJSON()]
        )
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let channel = Phase3RealtimeChannelFake(log: Phase3CallLog())
        let ticker = Phase3ReconciliationTickerFake()
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceRealtimeCoordinator(
            repository: repository,
            cache: cache,
            channel: channel,
            reconciliationTicker: ticker,
            timeSource: time
        )
        try await coordinator.friendsSurfaceBecameActive()
        await transport.setRows(
            presenceJSON(
                userID: Phase3Fixture.other,
                placeID: "main-green"
            ),
            for: .presenceState
        )

        await channel.emitAnyAction()
        await transport.waitForSelectionCount(2)

        let visible = await cache.visiblePresence(at: await time.now())
        XCTAssertEqual(visible.map(\.userID), [Phase3Fixture.other])
        XCTAssertEqual(visible.map(\.placeID), ["main-green"])
        XCTAssertFalse(
            visible.contains { $0.userID == Phase3Fixture.friend },
            "Realtime payloads invalidate; they may never be merged as display truth."
        )
    }

    func testSixtySecondForegroundTickReconcilesEvenWithoutRealtimeEvent()
        async throws
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [.presenceState: presenceJSON()]
        )
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let channel = Phase3RealtimeChannelFake(log: Phase3CallLog())
        let ticker = Phase3ReconciliationTickerFake()
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceRealtimeCoordinator(
            repository: repository,
            cache: cache,
            channel: channel,
            reconciliationTicker: ticker,
            timeSource: time
        )
        try await coordinator.friendsSurfaceBecameActive()
        await transport.setRows(
            presenceJSON(placeID: "sciences-library"),
            for: .presenceState
        )
        await time.advance(seconds: 60)

        await ticker.tick()
        await transport.waitForSelectionCount(2)

        let visible = await cache.visiblePresence(at: await time.now())
        XCTAssertEqual(visible.map(\.placeID), ["sciences-library"])
    }

    func testFailedReconciliationPurgesAllVisibleFriendPresence()
        async throws
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [.presenceState: presenceJSON()]
        )
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let channel = Phase3RealtimeChannelFake(log: Phase3CallLog())
        let ticker = Phase3ReconciliationTickerFake()
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceRealtimeCoordinator(
            repository: repository,
            cache: cache,
            channel: channel,
            reconciliationTicker: ticker,
            timeSource: time
        )
        try await coordinator.friendsSurfaceBecameActive()
        await transport.failNextSelect(.presenceState, with: .offline)
        await time.advance(seconds: 60)

        await ticker.tick()
        await transport.waitForSelectionCount(2)

        let visible = await cache.visiblePresence(at: await time.now())
        XCTAssertTrue(
            visible.filter { $0.userID != Phase3Fixture.me }.isEmpty
        )
    }

    func testBackgroundRemovesChannelPurgesAndStopsReconciliation()
        async throws
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [.presenceState: presenceJSON()]
        )
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let log = Phase3CallLog()
        let channel = Phase3RealtimeChannelFake(log: log)
        let ticker = Phase3ReconciliationTickerFake()
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceRealtimeCoordinator(
            repository: repository,
            cache: cache,
            channel: channel,
            reconciliationTicker: ticker,
            timeSource: time
        )
        try await coordinator.friendsSurfaceBecameActive()

        await coordinator.friendsSurfaceBecameInactive()

        let callLog = await log.values()
        XCTAssertEqual(
            callLog,
            [
                "channel.any-action-stream",
                "channel.subscribe",
                "channel.remove",
            ]
        )
        let visible = await cache.visiblePresence(at: await time.now())
        XCTAssertTrue(visible.isEmpty)

        await time.advance(seconds: 60)
        await ticker.tick()
        await drainPhase3Tasks()
        let selections = await transport.selections()
        XCTAssertEqual(selections.count, 1)
    }

    func testConnectionFailureAndSignOutChannelRemovalPurgeImmediately()
        async throws
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [.presenceState: presenceJSON()]
        )
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let log = Phase3CallLog()
        let channel = Phase3RealtimeChannelFake(log: log)
        let coordinator = PresenceRealtimeCoordinator(
            repository: repository,
            cache: cache,
            channel: channel,
            reconciliationTicker: Phase3ReconciliationTickerFake(),
            timeSource: Phase3ManualTimeSource()
        )
        try await coordinator.friendsSurfaceBecameActive()

        await coordinator.connectionFailed()

        let time = PresenceTime(
            wallClock: Phase3Fixture.baseDate,
            monotonic: .zero
        )
        let afterFailure = await cache.visiblePresence(at: time)
        XCTAssertTrue(afterFailure.isEmpty)
        let callLog = await log.values()
        XCTAssertEqual(callLog.last, "channel.remove")

        await cache.replace(
            Phase3Fixture.snapshot(),
            at: time
        )
        await coordinator.removeRealtimeChannels()
        let afterSignOut = await cache.snapshot(at: time)
        XCTAssertEqual(afterSignOut, .empty)
    }

    func testSubscriptionFailureRemovesChannelPurgesAndSurfacesError()
        async
    {
        let transport = Phase3SocialTransportRecorder()
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let log = Phase3CallLog()
        let channel = Phase3RealtimeChannelFake(log: log)
        await channel.failSubscription(with: .subscriptionRejected)
        let time = PresenceTime(
            wallClock: Phase3Fixture.baseDate,
            monotonic: .zero
        )
        await cache.replace(Phase3Fixture.snapshot(), at: time)
        let coordinator = PresenceRealtimeCoordinator(
            repository: repository,
            cache: cache,
            channel: channel,
            reconciliationTicker: Phase3ReconciliationTickerFake(),
            timeSource: Phase3ManualTimeSource()
        )

        do {
            try await coordinator.friendsSurfaceBecameActive()
            XCTFail("Expected subscribeWithError failure.")
        } catch {
            XCTAssertEqual(
                error as? Phase3TestFailure,
                .subscriptionRejected
            )
        }

        let callLog = await log.values()
        XCTAssertEqual(
            callLog,
            [
                "channel.any-action-stream",
                "channel.subscribe",
                "channel.remove",
            ]
        )
        let snapshot = await cache.snapshot(at: time)
        XCTAssertEqual(snapshot, .empty)
        let selections = await transport.selections()
        XCTAssertTrue(selections.isEmpty)
    }

    func testConcurrentAcquiresShareOneSerializedActivation()
        async throws
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [.presenceState: "[]"]
        )
        let channel = Phase3RealtimeChannelFake(log: Phase3CallLog())
        await channel.blockNextSubscribe()
        let coordinator = PresenceRealtimeCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            channel: channel,
            reconciliationTicker: Phase3ReconciliationTickerFake(),
            timeSource: Phase3ManualTimeSource()
        )

        let first = Task {
            try await coordinator.acquireFriendsSurface()
        }
        await channel.waitForSubscribeCount(1)
        let second = Task {
            try await coordinator.acquireFriendsSurface()
        }
        await coordinator.waitForLifecycleTransitionWaiterCount(1)
        let subscriptionsWhileBlocked =
            await channel.numberOfSubscriptions()
        XCTAssertEqual(subscriptionsWhileBlocked, 1)

        await channel.releaseSubscribe()
        let firstLease = try await first.value
        let secondLease = try await second.value
        XCTAssertEqual(firstLease, secondLease)
        let finalSubscriptionCount =
            await channel.numberOfSubscriptions()
        XCTAssertEqual(finalSubscriptionCount, 1)
    }

    func testBlockedActivationThenStopThenNewAcquireCannotPurgeNewLifecycle()
        async throws
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [.presenceState: "[]"]
        )
        let log = Phase3CallLog()
        let channel = Phase3RealtimeChannelFake(log: log)
        await channel.blockNextSubscribe()
        let purgeGate = Phase3AsyncGate()
        let cache = SensitiveCache(
            currentUserID: Phase3Fixture.me,
            beforePurge: { reason in
                if reason == .sceneBackgrounded {
                    await purgeGate.wait()
                }
            }
        )
        let coordinator = PresenceRealtimeCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: cache,
            channel: channel,
            reconciliationTicker: Phase3ReconciliationTickerFake(),
            timeSource: Phase3ManualTimeSource()
        )

        let first = Task {
            try await coordinator.acquireFriendsSurface()
        }
        await channel.waitForSubscribeCount(1)
        let stopSequence =
            await coordinator.currentStopRequestSequence()
        let stop = Task {
            await coordinator.friendsSurfaceBecameInactive()
        }
        await coordinator.waitForStopRequest(after: stopSequence)
        await purgeGate.waitForWaiterCount(1)
        let replacement = Task {
            try await coordinator.acquireFriendsSurface()
        }
        await coordinator.waitForLifecycleTransitionWaiterCount(2)
        await channel.releaseSubscribe()

        do {
            _ = try await first.value
            XCTFail("The stop request must invalidate the blocked activation.")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        await purgeGate.releaseAll()
        await stop.value
        let replacementLease = try await replacement.value
        XCTAssertGreaterThan(replacementLease, 0)
        let subscriptionCount = await channel.numberOfSubscriptions()
        XCTAssertEqual(subscriptionCount, 2)
        let callLog = await log.values()
        XCTAssertEqual(
            callLog,
            [
                "channel.any-action-stream",
                "channel.subscribe",
                "channel.remove",
                "channel.any-action-stream",
                "channel.subscribe",
            ]
        )
    }

    func testSignOutPurgesBeforeBlockedInitialFetchCanReturn()
        async
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [.presenceState: presenceJSON()]
        )
        await transport.blockSelection(
            .presenceState,
            occurrence: 1
        )
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        await cache.replace(
            Phase3Fixture.snapshot(),
            at: await time.now()
        )
        let channel = Phase3RealtimeChannelFake(log: Phase3CallLog())
        let coordinator = PresenceRealtimeCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: cache,
            channel: channel,
            reconciliationTicker: Phase3ReconciliationTickerFake(),
            timeSource: time
        )

        let activation = Task {
            try await coordinator.acquireFriendsSurface()
        }
        await transport.waitForSelectionCount(1)
        let generationBeforeSignOut =
            await cache.currentProtectionGeneration()
        let stopSequence =
            await coordinator.currentStopRequestSequence()
        let signOut = Task {
            await coordinator.removeRealtimeChannels()
        }
        await coordinator.waitForStopRequest(after: stopSequence)
        let purgeCompleted =
            await waitForProtectionGenerationAdvance(
                in: cache,
                after: generationBeforeSignOut,
                timeout: .seconds(1)
            )
        guard purgeCompleted else {
            await transport.releaseSelection(.presenceState)
            _ = try? await activation.value
            await signOut.value
            return XCTFail(
                "The sign-out purge did not complete within the bounded test deadline."
            )
        }

        let purgedBeforeRelease = await cache.snapshot(
            at: await time.now()
        )
        XCTAssertEqual(purgedBeforeRelease, .empty)

        await transport.releaseSelection(.presenceState)
        do {
            _ = try await activation.value
            XCTFail("The stale activation must not survive sign-out.")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        await signOut.value
        let afterRelease = await cache.snapshot(at: await time.now())
        XCTAssertEqual(afterRelease, .empty)
        await channel.waitForRemoveCount(1)
    }

    func testStaleFailureStreamCannotStopReplacementLifecycle()
        async throws
    {
        let transport = Phase3SocialTransportRecorder(
            rows: [.presenceState: "[]"]
        )
        let channel = Phase3RealtimeChannelFake(log: Phase3CallLog())
        let coordinator = PresenceRealtimeCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            channel: channel,
            reconciliationTicker: Phase3ReconciliationTickerFake(),
            timeSource: Phase3ManualTimeSource()
        )

        _ = try await coordinator.acquireFriendsSurface()
        await coordinator.friendsSurfaceBecameInactive()
        let oldFailureStreamTerminated =
            await channel.waitForConnectionFailureStreamTermination(
                streamAt: 0
            )
        guard oldFailureStreamTerminated else {
            return XCTFail(
                "Stopping the old lifecycle must promptly cancel its failure stream."
            )
        }
        let replacementLease =
            try await coordinator.acquireFriendsSurface()

        let staleEventWasDelivered =
            await channel.emitConnectionFailure(streamAt: 0)
        XCTAssertFalse(
            staleEventWasDelivered,
            "Stopping the old lifecycle must cancel its failure stream before a replacement subscribes."
        )
        let stillActiveLease =
            try await coordinator.acquireFriendsSurface()

        XCTAssertEqual(stillActiveLease, replacementLease)
        let subscriptionCount = await channel.numberOfSubscriptions()
        XCTAssertEqual(subscriptionCount, 2)
    }

    private func waitForProtectionGenerationAdvance(
        in cache: SensitiveCache,
        after generation: UInt64,
        timeout: Duration
    ) async -> Bool {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while clock.now < deadline {
            if await cache.currentProtectionGeneration() != generation {
                return true
            }
            do {
                try await clock.sleep(for: .milliseconds(1))
            } catch {
                return false
            }
        }
        return await cache.currentProtectionGeneration() != generation
    }

    private func presenceJSON(
        userID: UUID = Phase3Fixture.friend,
        placeID: String = "rockefeller-library"
    ) -> String {
        """
        [{
          "user_id":"\(userID.uuidString.lowercased())",
          "place_id":"\(placeID)",
          "status":"studying",
          "note":"Third floor",
          "ghost":false,
          "updated_at":"2027-01-15T08:00:00Z",
          "expires_at":"2027-01-15T08:10:00Z"
        }]
        """
    }

    private func drainPhase3Tasks() async {
        for _ in 0..<20 {
            await Task.yield()
        }
    }
}
