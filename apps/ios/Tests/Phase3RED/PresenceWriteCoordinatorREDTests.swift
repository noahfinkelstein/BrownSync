import Foundation
import XCTest

@testable import BrownSync

final class PresenceWriteCoordinatorREDTests: XCTestCase {
    func testSuccessfulPresenceWritesAreNeverLessThanSixtySecondsApart()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceWriteCoordinator(
            repository: repository,
            cache: cache,
            timeSource: time,
            minimumSuccessfulSetInterval: .seconds(60)
        )
        let first = confirmed(placeID: "rockefeller-library")
        let second = confirmed(placeID: "main-green")

        let firstDisposition = try await coordinator.submit(first)
        XCTAssertEqual(firstDisposition, .sent)
        await time.advance(seconds: 59)
        let secondDisposition = try await coordinator.submit(second)
        XCTAssertEqual(secondDisposition, .coalesced)
        try await coordinator.flushPendingIfDue()
        var records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.setPresence])

        await time.advance(seconds: 1)
        try await coordinator.flushPendingIfDue()

        records = await transport.records()
        XCTAssertEqual(
            records.map(\.function),
            [.setPresence, .setPresence]
        )
        XCTAssertEqual(
            try phase3JSONObject(records[1].payload)["p_place_id"]
                as? String,
            "main-green"
        )
    }

    func testCooldownStartsWhenSlowSetSucceedsNotWhenItWasSubmitted()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.blockNextRPC(.setPresence)
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            timeSource: time
        )
        let firstPresence = confirmed(
            placeID: "rockefeller-library"
        )
        let first = Task {
            try await coordinator.submit(firstPresence)
        }
        await transport.waitForRPCCount(1)
        await time.advance(seconds: 100)
        await transport.releaseRPC(.setPresence)
        _ = try await first.value

        await time.advance(seconds: 59)
        let beforeDueDisposition = try await coordinator.submit(
            confirmed(placeID: "main-green")
        )
        XCTAssertEqual(beforeDueDisposition, .coalesced)
        try await coordinator.flushPendingIfDue()
        let beforeDue = await transport.records()
        XCTAssertEqual(beforeDue.count, 1)

        await time.advance(seconds: 1)
        try await coordinator.flushPendingIfDue()
        let atDue = await transport.records()
        XCTAssertEqual(atDue.count, 2)
    }

    func testCoalescingRetainsOnlyNewestConfirmedPresence() async throws {
        let transport = Phase3SocialTransportRecorder()
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceWriteCoordinator(
            repository: repository,
            cache: cache,
            timeSource: time
        )

        _ = try await coordinator.submit(
            confirmed(placeID: "rockefeller-library")
        )
        await time.advance(seconds: 10)
        _ = try await coordinator.submit(
            confirmed(placeID: "andrews-commons")
        )
        await time.advance(seconds: 10)
        _ = try await coordinator.submit(
            confirmed(placeID: "sciences-library")
        )
        await time.advance(seconds: 40)
        try await coordinator.flushPendingIfDue()

        let records = await transport.records()
        XCTAssertEqual(records.count, 2)
        XCTAssertEqual(
            try phase3JSONObject(records[1].payload)["p_place_id"]
                as? String,
            "sciences-library"
        )
        XCTAssertFalse(
            try records.dropFirst().contains {
                try phase3JSONObject($0.payload)["p_place_id"] as? String
                    == "andrews-commons"
            }
        )
    }

    func testPendingPresenceGetsOneAutomaticDueTimeTask() async throws {
        let transport = Phase3SocialTransportRecorder()
        let repository = SupabaseSocialRepository(transport: transport)
        let time = Phase3ManualTimeSource()
        let sleeper = Phase3PresenceWriteSleeperFake()
        let coordinator = PresenceWriteCoordinator(
            repository: repository,
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            timeSource: time,
            sleeper: sleeper
        )

        _ = try await coordinator.submit(
            confirmed(placeID: "rockefeller-library")
        )
        _ = try await coordinator.submit(
            confirmed(placeID: "main-green")
        )
        await sleeper.waitForSleepCount(1)
        let scheduledDurations = await sleeper.durations()
        XCTAssertEqual(scheduledDurations, [.seconds(60)])
        await time.advance(seconds: 60)
        await sleeper.releaseNextSleep()
        await transport.waitForRPCCount(2)

        let records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.setPresence, .setPresence])
        XCTAssertFalse(
            records[1].taskWasCancelled,
            "The scheduled task must not cancel itself before entering the RPC."
        )
        XCTAssertEqual(
            try phase3JSONObject(records[1].payload)["p_place_id"] as? String,
            "main-green"
        )
    }

    func testFailedSetDoesNotConsumeCooldownOrSpinARetry() async {
        let transport = Phase3SocialTransportRecorder()
        await transport.failNextRPC(.setPresence, with: .rateLimited)
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceWriteCoordinator(
            repository: repository,
            cache: cache,
            timeSource: time
        )

        do {
            _ = try await coordinator.submit(
                confirmed(placeID: "rockefeller-library")
            )
            XCTFail("Expected the database limiter error.")
        } catch {
            XCTAssertEqual(error as? Phase3TestFailure, .rateLimited)
        }

        let afterFailure = await transport.records()
        XCTAssertEqual(afterFailure.map(\.function), [.setPresence])
        do {
            let disposition = try await coordinator.submit(
                confirmed(placeID: "main-green")
            )
            XCTAssertEqual(disposition, .sent)
        } catch {
            XCTFail("A failed set must not consume the local cooldown: \(error)")
        }

        await time.advance(seconds: 61)
        try? await coordinator.flushPendingIfDue()
        let finalRecords = await transport.records()
        XCTAssertEqual(finalRecords.count, 2)
    }

    func testDueDirectSubmissionReplacesOlderScheduledPendingValue()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            timeSource: time
        )

        _ = try await coordinator.submit(
            confirmed(placeID: "rockefeller-library")
        )
        await time.advance(seconds: 10)
        _ = try await coordinator.submit(
            confirmed(placeID: "andrews-commons")
        )
        await time.advance(seconds: 50)
        let directDisposition = try await coordinator.submit(
            confirmed(placeID: "main-green")
        )
        XCTAssertEqual(directDisposition, .sent)
        await time.advance(seconds: 60)
        try await coordinator.flushPendingIfDue()

        let records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.setPresence, .setPresence])
        XCTAssertEqual(
            try phase3JSONObject(records[1].payload)["p_place_id"] as? String,
            "main-green"
        )
    }

    func testInitialFailureReleasesOnlyNewerCoalescedValueImmediately()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.blockNextRPC(.setPresence)
        await transport.failNextRPC(.setPresence, with: .rateLimited)
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            timeSource: Phase3ManualTimeSource()
        )
        let initialPresence = confirmed(
            placeID: "rockefeller-library"
        )
        let initial = Task {
            try await coordinator.submit(initialPresence)
        }
        await transport.waitForRPCCount(1)
        let coalescedDisposition = try await coordinator.submit(
            confirmed(placeID: "main-green")
        )
        XCTAssertEqual(coalescedDisposition, .coalesced)

        await transport.releaseRPC(.setPresence)
        do {
            _ = try await initial.value
            XCTFail("Expected the first RPC to fail.")
        } catch {
            XCTAssertEqual(error as? Phase3TestFailure, .rateLimited)
        }
        await transport.waitForRPCCount(2)

        let records = await transport.records()
        XCTAssertEqual(records.count, 2)
        XCTAssertEqual(
            try phase3JSONObject(records[1].payload)["p_place_id"] as? String,
            "main-green"
        )
    }

    func testSignOutCancellationReturnsWithoutWaitingForInflightNetwork()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.blockNextRPC(.setPresence)
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            timeSource: Phase3ManualTimeSource()
        )
        let submittedPresence = confirmed(
            placeID: "rockefeller-library"
        )
        let inFlight = Task {
            try await coordinator.submit(submittedPresence)
        }
        await transport.waitForRPCCount(1)

        await coordinator.cancelProtectedTasks()

        let recordsAtCancellation = await transport.records()
        XCTAssertEqual(recordsAtCancellation.map(\.function), [.setPresence])
        await transport.releaseRPC(.setPresence)
        _ = try await inFlight.value

        await coordinator.activateProtectedSession(
            userID: Phase3Fixture.me
        )
        let newSessionDisposition = try await coordinator.submit(
            confirmed(placeID: "main-green")
        )
        XCTAssertEqual(
            newSessionDisposition,
            .sent,
            "A late old-session success must not cool down a new session."
        )
    }

    func testClearBypassesPendingQueuePurgesBeforeServerReturnsAndDropsPending()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceWriteCoordinator(
            repository: repository,
            cache: cache,
            timeSource: time
        )
        let now = await time.now()
        let own = Phase3Fixture.presence(
            userID: Phase3Fixture.me,
            expiresIn: 600
        )
        await cache.replaceVisiblePresence([own], at: now)
        _ = try await coordinator.submit(
            confirmed(placeID: "rockefeller-library")
        )
        await time.advance(seconds: 10)
        _ = try await coordinator.submit(
            confirmed(placeID: "main-green")
        )
        await transport.blockNextRPC(.clearPresence)

        let clearTask = Task {
            try await coordinator.clearPresence()
        }
        await transport.waitForRPCCount(2)

        let duringServerCall = await cache.visiblePresence(
            at: await time.now()
        )
        XCTAssertTrue(
            duringServerCall.allSatisfy {
                $0.userID != Phase3Fixture.me
            },
            "Local presence must hide before the privacy RPC returns."
        )

        await transport.releaseRPC(.clearPresence)
        try await clearTask.value
        await time.advance(seconds: 60)
        try await coordinator.flushPendingIfDue()

        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.function),
            [.setPresence, .clearPresence],
            "Clearing must discard a queued location instead of republishing it."
        )
    }

    func testClearWaitsOutAnInflightSetThenOrdersPrivacyRPCStrictlyAfterIt()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.blockNextRPC(.setPresence)
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceWriteCoordinator(
            repository: repository,
            cache: cache,
            timeSource: time
        )
        await cache.replaceVisiblePresence(
            [
                Phase3Fixture.presence(
                    userID: Phase3Fixture.me,
                    expiresIn: 600
                )
            ],
            at: await time.now()
        )
        let submittedPresence = confirmed(
            placeID: "rockefeller-library"
        )
        let setTask = Task {
            try await coordinator.submit(submittedPresence)
        }
        await transport.waitForRPCCount(1)

        let clearTask = Task {
            try await coordinator.clearPresence()
        }
        for _ in 0..<20 {
            await Task.yield()
        }

        let duringPrivacy = await cache.visiblePresence(
            at: await time.now()
        )
        XCTAssertTrue(
            duringPrivacy.isEmpty,
            "The cache must hide before waiting for the in-flight publish."
        )
        let beforeRelease = await transport.records()
        XCTAssertEqual(
            beforeRelease.map(\.function),
            [.setPresence],
            "The privacy RPC must serialize after the in-flight set."
        )

        await transport.releaseRPC(.setPresence)
        _ = try await setTask.value
        try await clearTask.value
        let afterClear = await transport.records()
        XCTAssertEqual(
            afterClear.map(\.function),
            [.setPresence, .clearPresence]
        )
    }

    func testFailedGhostEnableStaysLocallyHiddenAndReportsUnconfirmed()
        async
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.failNextRPC(.setGhost, with: .offline)
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceWriteCoordinator(
            repository: repository,
            cache: cache,
            timeSource: time
        )
        await cache.replaceVisiblePresence(
            [
                Phase3Fixture.presence(
                    userID: Phase3Fixture.me,
                    expiresIn: 600
                )
            ],
            at: await time.now()
        )

        do {
            try await coordinator.setGhost(true)
            XCTFail("The UI must be told that the server did not confirm ghost mode.")
        } catch {
            XCTAssertEqual(error as? Phase3TestFailure, .offline)
        }

        let visible = await cache.visiblePresence(at: await time.now())
        XCTAssertTrue(visible.isEmpty)
        let records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.setGhost])
    }

    func testRevokeBlockAndRemoveBypassSetCooldown() async throws {
        let transport = Phase3SocialTransportRecorder()
        let repository = SupabaseSocialRepository(transport: transport)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceWriteCoordinator(
            repository: repository,
            cache: cache,
            timeSource: time
        )
        await cache.replace(
            Phase3Fixture.snapshot(),
            at: await time.now()
        )
        _ = try await coordinator.submit(
            confirmed(placeID: "rockefeller-library")
        )
        await time.advance(seconds: 1)
        _ = try await coordinator.submit(
            confirmed(placeID: "main-green")
        )

        try await coordinator.revokePresenceShare(
            viewerID: Phase3Fixture.friend
        )
        try await coordinator.blockUser(
            otherUserID: Phase3Fixture.friend
        )
        try await coordinator.removeFriend(
            otherUserID: Phase3Fixture.other
        )

        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.function),
            [
                .setPresence,
                .revokePresenceShare,
                .blockUser,
                .removeFriend,
            ]
        )
        await time.advance(seconds: 60)
        try await coordinator.flushPendingIfDue()
        let afterFlush = await transport.records()
        XCTAssertEqual(
            afterFlush.filter { $0.function == .setPresence }.count,
            1,
            "Privacy actions must discard a pending publish."
        )
    }

    func testPrivacyRPCsAreStrictlySerializedIncludingGhostDisable()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.blockNextRPC(.clearPresence)
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            timeSource: Phase3ManualTimeSource()
        )

        let clear = Task { try await coordinator.clearPresence() }
        await transport.waitForRPCCount(1)
        let unghost = Task { try await coordinator.setGhost(false) }
        let revoke = Task {
            try await coordinator.revokePresenceShare(
                viewerID: Phase3Fixture.friend
            )
        }
        for _ in 0..<20 {
            await Task.yield()
        }
        let blocked = await transport.records()
        XCTAssertEqual(blocked.map(\.function), [.clearPresence])

        await transport.releaseRPC(.clearPresence)
        try await clear.value
        try await unghost.value
        try await revoke.value
        let completed = await transport.records()
        XCTAssertEqual(
            completed.map(\.function),
            [.clearPresence, .setGhost, .revokePresenceShare]
        )
    }

    func testForegroundResumeCannotReenableAnInvalidatedSession()
        async throws
    {
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(
                transport: Phase3SocialTransportRecorder()
            ),
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            timeSource: Phase3ManualTimeSource(),
            initiallyActive: false
        )
        await coordinator.activateProtectedSession(
            userID: Phase3Fixture.me
        )
        await coordinator.cancelProtectedTasks()
        await coordinator.resumePublishingForForeground()

        do {
            _ = try await coordinator.submit(
                confirmed(placeID: "main-green")
            )
            XCTFail("A scene resume must not revive an invalid auth session.")
        } catch {
            XCTAssertEqual(
                error as? PresenceWriteCoordinatorError,
                .protectedSessionInactive
            )
        }
    }

    func testAdmissionWhileSceneIsAlreadyActiveRestoresPublishing()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            timeSource: Phase3ManualTimeSource()
        )
        await coordinator.suspendPublishingForBackground()
        await coordinator.cancelProtectedTasks()
        await coordinator.activateProtectedSession(
            userID: Phase3Fixture.me
        )
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
        await coordinator.resumePublishingForForeground()

        let disposition = try await coordinator.submit(
            confirmed(placeID: "main-green")
        )
        XCTAssertEqual(disposition, .sent)
        let records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.setPresence])
    }

    func testQueuedPrivacyRPCIsDroppedAfterSessionInvalidation()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.blockNextRPC(.clearPresence)
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            timeSource: Phase3ManualTimeSource()
        )
        let clear = Task { try await coordinator.clearPresence() }
        await transport.waitForRPCCount(1)
        let queued = Task { try await coordinator.setGhost(false) }
        for _ in 0..<10 {
            await Task.yield()
        }

        await coordinator.cancelProtectedTasks()
        await transport.releaseRPC(.clearPresence)
        try await clear.value
        do {
            try await queued.value
            XCTFail("Queued old-session privacy work must not reach the RPC.")
        } catch {
            XCTAssertEqual(
                error as? PresenceWriteCoordinatorError,
                .protectedSessionInactive
            )
        }
        let records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.clearPresence])
    }

    func testOldPrivacyCompletionCannotDiscardNewSessionPendingPresence()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.blockNextRPC(.clearPresence)
        let time = Phase3ManualTimeSource()
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            timeSource: time
        )

        let oldClear = Task { try await coordinator.clearPresence() }
        await transport.waitForRPCCount(1)
        await coordinator.cancelProtectedTasks()
        await coordinator.activateProtectedSession(
            userID: Phase3Fixture.me
        )
        _ = try await coordinator.submit(
            confirmed(placeID: "rockefeller-library")
        )
        await time.advance(seconds: 10)
        let pendingDisposition = try await coordinator.submit(
            confirmed(placeID: "main-green")
        )
        XCTAssertEqual(pendingDisposition, .coalesced)

        await transport.releaseRPC(.clearPresence)
        try await oldClear.value
        await time.advance(seconds: 50)
        try await coordinator.flushPendingIfDue()

        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.function),
            [.clearPresence, .setPresence, .setPresence]
        )
        XCTAssertEqual(
            try phase3JSONObject(records[2].payload)["p_place_id"]
                as? String,
            "main-green"
        )
    }

    func testSuccessfulGhostDisableRemovesDurableGhostSentinel()
        async throws
    {
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        let sentinel = PresenceState(
            userID: Phase3Fixture.me,
            placeID: nil,
            status: nil,
            note: nil,
            ghost: true,
            updatedAt: Phase3Fixture.baseDate,
            expiresAt: Phase3Fixture.baseDate
        )
        await cache.replaceVisiblePresence(
            [sentinel],
            at: await time.now()
        )
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(
                transport: Phase3SocialTransportRecorder()
            ),
            cache: cache,
            timeSource: time
        )

        try await coordinator.setGhost(false)

        let snapshot = await cache.snapshot(at: await time.now())
        XCTAssertFalse(
            snapshot.presence.contains {
                $0.userID == Phase3Fixture.me && $0.ghost
            }
        )
    }

    func testSuccessfulGhostEnableRetainsPrivateSentinelForReopenAndDisable()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        await cache.replaceVisiblePresence(
            [
                Phase3Fixture.presence(
                    userID: Phase3Fixture.me,
                    expiresIn: 600
                )
            ],
            at: await time.now()
        )
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: cache,
            timeSource: time
        )

        try await coordinator.setGhost(true)

        let reopened = await cache.snapshot(at: await time.now())
        let sentinel = try XCTUnwrap(
            reopened.presence.first {
                $0.userID == Phase3Fixture.me
            }
        )
        XCTAssertTrue(sentinel.ghost)
        XCTAssertNil(sentinel.placeID)
        XCTAssertNil(sentinel.note)

        try await coordinator.setGhost(false)
        let records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.setGhost, .setGhost])
        XCTAssertEqual(
            try phase3JSONObject(records[0].payload)["p_ghost"]
                as? Bool,
            true
        )
        XCTAssertEqual(
            try phase3JSONObject(records[1].payload)["p_ghost"]
                as? Bool,
            false
        )
    }

    func testGhostSentinelIsInstalledBeforeNextPrivacyTurnStarts()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.blockNextRPC(.blockUser)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3GatedTimeSource()
        await time.blockNextNow()
        await cache.replace(
            Phase3Fixture.snapshot(),
            at: PresenceTime(
                wallClock: Phase3Fixture.baseDate,
                monotonic: .zero
            )
        )
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: cache,
            timeSource: time
        )

        let enable = Task {
            try await coordinator.setGhost(true)
        }
        await transport.waitForRPCCount(1)
        await time.waitForNowCount(1)

        let block = Task {
            try await coordinator.blockUser(
                otherUserID: Phase3Fixture.friend
            )
        }
        await coordinator.waitForPrivacyRPCWaiterCount(1)
        var records = await transport.records()
        XCTAssertEqual(
            records.map(\.function),
            [.setGhost],
            "The next privacy RPC must wait for confirmed ghost cache work."
        )

        await time.releaseNow()
        await transport.waitForRPCCount(2)
        let whileBlockIsInFlight = await cache.snapshot(
            at: PresenceTime(
                wallClock: Phase3Fixture.baseDate,
                monotonic: .zero
            )
        )
        let sentinel = try XCTUnwrap(
            whileBlockIsInFlight.presence.first {
                $0.userID == Phase3Fixture.me
            }
        )
        XCTAssertTrue(sentinel.ghost)
        XCTAssertNil(sentinel.placeID)
        XCTAssertNil(sentinel.note)

        await transport.releaseRPC(.blockUser)
        try await enable.value
        try await block.value

        records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.setGhost, .blockUser])
        let afterBlock = await cache.snapshot(
            at: PresenceTime(
                wallClock: Phase3Fixture.baseDate,
                monotonic: .zero
            )
        )
        XCTAssertTrue(
            afterBlock.presence.contains {
                $0.userID == Phase3Fixture.me
                    && $0.ghost
                    && $0.placeID == nil
                    && $0.note == nil
            },
            "Later privacy redaction must preserve the durable ghost sentinel."
        )
    }

    func testLateGhostEnableSuccessCannotRepopulateBackgroundPurgedCache()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.blockNextRPC(.setGhost)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        await cache.replaceVisiblePresence(
            [
                Phase3Fixture.presence(
                    userID: Phase3Fixture.me,
                    expiresIn: 600
                )
            ],
            at: await time.now()
        )
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: cache,
            timeSource: time
        )
        let enable = Task {
            try await coordinator.setGhost(true)
        }
        await transport.waitForRPCCount(1)

        await coordinator.suspendPublishingForBackground()
        await cache.purge(reason: .sceneBackgrounded)
        await transport.releaseRPC(.setGhost)
        try await enable.value

        let afterLateSuccess = await cache.snapshot(
            at: await time.now()
        )
        XCTAssertEqual(
            afterLateSuccess,
            .empty,
            "A late privacy RPC success must not repopulate sensitive state after background purge."
        )
    }

    func testLateGhostEnableCannotRepopulateFriendsSurfacePurge()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.blockNextRPC(.setGhost)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        await cache.replaceVisiblePresence(
            [
                Phase3Fixture.presence(
                    userID: Phase3Fixture.me,
                    expiresIn: 600
                )
            ],
            at: await time.now()
        )
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: cache,
            timeSource: time
        )
        let enable = Task {
            try await coordinator.setGhost(true)
        }
        await transport.waitForRPCCount(1)

        _ = await cache.purge(
            reason: .sceneBackgrounded,
            ownedBy: Phase3Fixture.me
        )
        await transport.releaseRPC(.setGhost)
        try await enable.value

        let afterLateSuccess = await cache.snapshot(
            at: await time.now()
        )
        XCTAssertEqual(
            afterLateSuccess,
            .empty,
            "A Friends-tab purge must fence out a late confirmed ghost cache effect even while the write session remains active."
        )
    }

    func testInflightPrivacyRedactionSurvivesIncomingCacheReplacement()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.blockNextRPC(.blockUser)
        await transport.failNextRPC(.blockUser, with: .offline)
        let cache = SensitiveCache(currentUserID: Phase3Fixture.me)
        let time = Phase3ManualTimeSource()
        await cache.replace(
            Phase3Fixture.snapshot(),
            at: await time.now()
        )
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: cache,
            timeSource: time
        )

        let blocked = Task {
            try await coordinator.blockUser(
                otherUserID: Phase3Fixture.friend
            )
        }
        await transport.waitForRPCCount(1)
        await cache.replace(
            Phase3Fixture.snapshot(),
            at: await time.now()
        )
        var snapshot = await cache.snapshot(at: await time.now())
        XCTAssertFalse(
            snapshot.profiles.contains {
                $0.id == Phase3Fixture.friend
            },
            "A refresh or realtime snapshot must not reveal the target while the privacy RPC is in flight."
        )

        await transport.releaseRPC(.blockUser)
        do {
            try await blocked.value
            XCTFail("Expected the server failure.")
        } catch {
            XCTAssertEqual(error as? Phase3TestFailure, .offline)
        }
        await cache.replace(
            Phase3Fixture.snapshot(),
            at: await time.now()
        )
        snapshot = await cache.snapshot(at: await time.now())
        XCTAssertFalse(
            snapshot.profiles.contains {
                $0.id == Phase3Fixture.friend
            },
            "The exact redaction must survive refresh until an explicit retry succeeds."
        )
    }

    func testDifferentPrivacyActionCannotOverwriteFailedExactRetry()
        async throws
    {
        let transport = Phase3SocialTransportRecorder()
        await transport.failNextRPC(.blockUser, with: .offline)
        let coordinator = PresenceWriteCoordinator(
            repository: SupabaseSocialRepository(transport: transport),
            cache: SensitiveCache(currentUserID: Phase3Fixture.me),
            timeSource: Phase3ManualTimeSource()
        )
        do {
            try await coordinator.blockUser(
                otherUserID: Phase3Fixture.friend
            )
            XCTFail("Expected the initial block failure.")
        } catch {
            XCTAssertEqual(error as? Phase3TestFailure, .offline)
        }

        do {
            try await coordinator.removeFriend(
                otherUserID: Phase3Fixture.friend
            )
            XCTFail("A different action must not overwrite the exact retry.")
        } catch {
            XCTAssertEqual(
                error as? PresenceWriteCoordinatorError,
                .unconfirmedPrivacyActionPending
            )
        }
        let unresolved =
            await coordinator.currentUnconfirmedPrivacyAction()
        XCTAssertEqual(
            unresolved,
            .blockUser(Phase3Fixture.friend)
        )
        try await coordinator.blockUser(
            otherUserID: Phase3Fixture.friend
        )
        let records = await transport.records()
        XCTAssertEqual(records.map(\.function), [.blockUser, .blockUser])
    }

    private func confirmed(placeID: String) -> ConfirmedPresence {
        ConfirmedPresence(
            placeID: placeID,
            status: .studying,
            note: nil,
            ttlSeconds: 300
        )
    }
}
