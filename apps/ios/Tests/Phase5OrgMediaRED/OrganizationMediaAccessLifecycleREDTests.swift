import CoreGraphics
import Foundation
import ImageIO
import OpenAPIRuntime
import UniformTypeIdentifiers
import XCTest

@testable import BrownSync

final class OrganizationMediaAccessLifecycleREDTests: XCTestCase {
    func testOnlyAdmittedAdminPassesTheLocalWriteGate() {
        let denied:
            [(
                OrganizationAdminAccess,
                OrganizationAssetError
            )] = [
                (.signedOut, .authenticationRequired),
                (.authenticating, .authenticationRequired),
                (.admittedNonAdmin, .authorityRequired),
            ]

        for (access, expected) in denied {
            XCTAssertThrowsError(
                try access.requireOrganizationAssetMutation()
            ) { error in
                XCTAssertEqual(
                    error as? OrganizationAssetError,
                    expected
                )
            }
        }
        XCTAssertNoThrow(
            try OrganizationAdminAccess.admittedAdmin
                .requireOrganizationAssetMutation()
        )
    }

    func testUploadSubmissionGetsOneUUIDAndUsesItForReservation()
        async throws
    {
        let repository = Phase5OrgMediaRepositoryFake()
        let store = Phase5OrgMediaProtectedStoreFake()
        let uuids = Phase5OrgMediaUUIDSource([
            Phase5OrgMediaFixture.requestID,
            Phase5OrgMediaFixture.secondRequestID,
        ])
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: repository,
            preparer: Phase5OrgImagePreparerFake(),
            protectedStore: store,
            uuids: uuids,
            logger: Phase5OrgMediaLogRecorder(),
            now: { Phase5OrgMediaFixture.now }
        )

        let submission = try await coordinator.prepareSubmission(
            transferableData: Data([0xFF, 0xD8, 0xFF, 0xD9]),
            kind: .gallery,
            altText: "Students broadcasting from the studio",
            collection: Phase5OrgMediaFixture.collection()
        )
        _ = try await coordinator.submit(
            submission,
            organizationID: Phase5OrgMediaFixture.organizationID
        )

        XCTAssertEqual(
            submission.clientRequestID,
            Phase5OrgMediaFixture.requestID
        )
        let uuidRequestCount = await uuids.requestCount()
        XCTAssertEqual(uuidRequestCount, 1)
        let calls = await repository.recordedCalls()
        guard case .reserve(_, let command) = calls.first else {
            return XCTFail("Expected reservation before upload")
        }
        XCTAssertEqual(
            command.clientRequestID,
            submission.clientRequestID
        )
        XCTAssertEqual(calls.count, 2)
    }

    func testCancellationClosesCoordinatorUntilAProtectedSessionReactivates()
        async throws
    {
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: Phase5OrgMediaRepositoryFake(),
            preparer: Phase5OrgImagePreparerFake(),
            protectedStore: Phase5OrgMediaProtectedStoreFake(),
            uuids: Phase5OrgMediaUUIDSource([
                Phase5OrgMediaFixture.requestID
            ])
        )

        await coordinator.cancelProtectedTasks()
        do {
            _ = try await coordinator.prepareSubmission(
                transferableData: Data([0x01]),
                kind: .gallery,
                altText: "Students broadcasting",
                collection: Phase5OrgMediaFixture.collection()
            )
            XCTFail("Expected the invalidated session to stay closed")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }

        await coordinator.activateProtectedSession(
            userID: UUID(
                uuidString: "10000000-0000-4000-8000-000000000099"
            )!
        )
        _ = try await coordinator.prepareSubmission(
            transferableData: Data([0x01]),
            kind: .gallery,
            altText: "Students broadcasting",
            collection: Phase5OrgMediaFixture.collection()
        )
    }

    func testFailedCleanupKeepsReactivationClosedUntilRetrySucceeds()
        async throws
    {
        let ownerID = UUID(
            uuidString: "10000000-0000-4000-8000-000000000091"
        )!
        let store = Phase5OrgMediaProtectedStoreFake(
            purgeAllResults: [false, false, true]
        )
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: Phase5OrgMediaRepositoryFake(),
            preparer: Phase5OrgImagePreparerFake(),
            protectedStore: store,
            uuids: Phase5OrgMediaUUIDSource([
                Phase5OrgMediaFixture.requestID
            ]),
            initiallyActive: false
        )
        let lifecycle = OrganizationMediaSceneLifecycle(
            tasks: coordinator,
            purger: OrganizationMediaSensitiveCachePurger(store: store),
            initiallySceneActive: false
        )
        await lifecycle.activate(userID: ownerID)

        await lifecycle.didEnterBackground()
        await lifecycle.didBecomeActive(userID: ownerID)

        await assertCoordinatorIsClosed(coordinator)

        await lifecycle.didBecomeActive(userID: ownerID)
        _ = try await coordinator.prepareSubmission(
            transferableData: Data([0x01]),
            kind: .gallery,
            altText: "Students broadcasting",
            collection: Phase5OrgMediaFixture.collection()
        )
        let purgeAllCalls = await store.recordedCalls().filter {
            if case .purgeAll = $0 { true } else { false }
        }
        XCTAssertEqual(
            purgeAllCalls,
            [
                .purgeAll(.sceneBackgrounded),
                .purgeAll(.sceneBackgrounded),
                .purgeAll(.sceneBackgrounded),
            ]
        )
    }

    func testSignOutBeforeStaleSceneActivationNeverReopensMedia()
        async
    {
        let ownerID = UUID(
            uuidString: "10000000-0000-4000-8000-000000000092"
        )!
        let store = Phase5OrgMediaProtectedStoreFake()
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: Phase5OrgMediaRepositoryFake(),
            preparer: Phase5OrgImagePreparerFake(),
            protectedStore: store,
            uuids: Phase5OrgMediaUUIDSource([
                Phase5OrgMediaFixture.requestID
            ]),
            initiallyActive: false
        )
        let lifecycle = OrganizationMediaSceneLifecycle(
            tasks: coordinator,
            purger: OrganizationMediaSensitiveCachePurger(store: store),
            initiallySceneActive: false
        )
        await lifecycle.activate(userID: ownerID)

        await lifecycle.invalidate(reason: .signedOut)
        await lifecycle.didBecomeActive(userID: ownerID)

        await assertCoordinatorIsClosed(coordinator)
        let purgeAllCalls = await store.recordedCalls().filter {
            if case .purgeAll = $0 { true } else { false }
        }
        XCTAssertEqual(purgeAllCalls, [.purgeAll(.signedOut)])
    }

    func testSceneActivationBeforeSignOutIsFollowedByClosure()
        async throws
    {
        let ownerID = UUID(
            uuidString: "10000000-0000-4000-8000-000000000093"
        )!
        let store = Phase5OrgMediaProtectedStoreFake()
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: Phase5OrgMediaRepositoryFake(),
            preparer: Phase5OrgImagePreparerFake(),
            protectedStore: store,
            uuids: Phase5OrgMediaUUIDSource([
                Phase5OrgMediaFixture.requestID
            ]),
            initiallyActive: false
        )
        let lifecycle = OrganizationMediaSceneLifecycle(
            tasks: coordinator,
            purger: OrganizationMediaSensitiveCachePurger(store: store),
            initiallySceneActive: false
        )
        await lifecycle.activate(userID: ownerID)
        await lifecycle.didBecomeActive(userID: ownerID)
        _ = try await coordinator.prepareSubmission(
            transferableData: Data([0x01]),
            kind: .gallery,
            altText: "Students broadcasting",
            collection: Phase5OrgMediaFixture.collection()
        )

        await lifecycle.invalidate(reason: .signedOut)

        await assertCoordinatorIsClosed(coordinator)
        let purgeAllCalls = await store.recordedCalls().filter {
            if case .purgeAll = $0 { true } else { false }
        }
        XCTAssertEqual(purgeAllCalls, [.purgeAll(.signedOut)])
    }

    func testSceneActivationRejectsAnOwnerMismatch() async throws {
        let ownerID = UUID(
            uuidString: "10000000-0000-4000-8000-000000000094"
        )!
        let otherUserID = UUID(
            uuidString: "10000000-0000-4000-8000-000000000095"
        )!
        let store = Phase5OrgMediaProtectedStoreFake()
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: Phase5OrgMediaRepositoryFake(),
            preparer: Phase5OrgImagePreparerFake(),
            protectedStore: store,
            uuids: Phase5OrgMediaUUIDSource([
                Phase5OrgMediaFixture.requestID
            ]),
            initiallyActive: false
        )
        let lifecycle = OrganizationMediaSceneLifecycle(
            tasks: coordinator,
            purger: OrganizationMediaSensitiveCachePurger(store: store),
            initiallySceneActive: false
        )
        await lifecycle.activate(userID: ownerID)

        await lifecycle.didBecomeActive(userID: otherUserID)

        await assertCoordinatorIsClosed(coordinator)

        await lifecycle.didBecomeActive(userID: ownerID)
        _ = try await coordinator.prepareSubmission(
            transferableData: Data([0x01]),
            kind: .gallery,
            altText: "Students broadcasting",
            collection: Phase5OrgMediaFixture.collection()
        )
    }

    func testSuccessfulUploadDoesNotReturnOrLogSuccessWhenPurgeFails()
        async throws
    {
        let store = Phase5OrgMediaProtectedStoreFake(
            purgeResults: [false]
        )
        let logger = Phase5OrgMediaLogRecorder()
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: Phase5OrgMediaRepositoryFake(),
            preparer: Phase5OrgImagePreparerFake(),
            protectedStore: store,
            uuids: Phase5OrgMediaUUIDSource([
                Phase5OrgMediaFixture.requestID
            ]),
            logger: logger,
            now: { Phase5OrgMediaFixture.now }
        )
        let submission = try await coordinator.prepareSubmission(
            transferableData: Data([0x01]),
            kind: .gallery,
            altText: "Students broadcasting",
            collection: Phase5OrgMediaFixture.collection()
        )

        await assertThrowsAssetError(
            .unavailable,
            try await coordinator.submit(
                submission,
                organizationID: Phase5OrgMediaFixture.organizationID
            )
        )
        let events = await logger.events()
        XCTAssertFalse(
            events.contains(
                .mutationFinished(
                    kind: .mediaUpload,
                    outcome: .succeeded
                )
            )
        )
    }

    func testExplicitMediaReplayReusesIDAcrossRealReservationCalls()
        async throws
    {
        let repository = Phase5OrgMediaRepositoryFake()
        await repository.setReservations([
            Phase5OrgMediaFixture.reservation(),
            Phase5OrgMediaFixture.reservation(replayed: true),
        ])
        await repository.setUploadOutcomes([
            .failure(.unavailable),
            .success(Phase5OrgMediaFixture.uploadResult()),
        ])
        let uuids = Phase5OrgMediaUUIDSource([
            Phase5OrgMediaFixture.requestID,
            Phase5OrgMediaFixture.secondRequestID,
        ])
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: repository,
            preparer: Phase5OrgImagePreparerFake(),
            protectedStore: Phase5OrgMediaProtectedStoreFake(),
            uuids: uuids,
            now: { Phase5OrgMediaFixture.now }
        )
        let original = try await coordinator.prepareSubmission(
            transferableData: Data([0x01]),
            kind: .gallery,
            altText: "Students broadcasting",
            collection: Phase5OrgMediaFixture.collection()
        )
        await assertThrowsAssetError(
            .unavailable,
            try await coordinator.submit(
                original,
                organizationID: Phase5OrgMediaFixture.organizationID
            )
        )

        let replay = try await coordinator.prepareReplay(
            of: original,
            transferableData: Data([0x01])
        )
        _ = try await coordinator.submit(
            replay,
            organizationID: Phase5OrgMediaFixture.organizationID
        )

        let reservationIDs = await repository.recordedCalls().compactMap {
            call -> UUID? in
            guard case .reserve(_, let command) = call else {
                return nil
            }
            return command.clientRequestID
        }
        let uuidRequestCount = await uuids.requestCount()
        XCTAssertEqual(
            reservationIDs,
            [
                Phase5OrgMediaFixture.requestID,
                Phase5OrgMediaFixture.requestID,
            ]
        )
        XCTAssertEqual(uuidRequestCount, 1)
    }

    func testReplayRejectsAChangedServerReservationIdentity()
        async throws
    {
        let changedUploadID = UUID(
            uuidString: "20000000-0000-4000-8000-000000000099"
        )!
        let repository = Phase5OrgMediaRepositoryFake()
        await repository.setReservations([
            Phase5OrgMediaFixture.reservation(),
            OrganizationMediaReservation(
                organizationID: Phase5OrgMediaFixture.organizationID,
                uploadID: changedUploadID,
                kind: .gallery,
                expiresAt: Phase5OrgMediaFixture.now.addingTimeInterval(600),
                replayed: true
            ),
        ])
        await repository.setUploadOutcomes([
            .failure(.unavailable)
        ])
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: repository,
            preparer: Phase5OrgImagePreparerFake(),
            protectedStore: Phase5OrgMediaProtectedStoreFake(),
            uuids: Phase5OrgMediaUUIDSource([
                Phase5OrgMediaFixture.requestID
            ]),
            now: { Phase5OrgMediaFixture.now }
        )
        let original = try await coordinator.prepareSubmission(
            transferableData: Data([0x01]),
            kind: .gallery,
            altText: "Students broadcasting",
            collection: Phase5OrgMediaFixture.collection()
        )
        await assertThrowsAssetError(
            .unavailable,
            try await coordinator.submit(
                original,
                organizationID: Phase5OrgMediaFixture.organizationID
            )
        )
        let replay = try await coordinator.prepareReplay(
            of: original,
            transferableData: Data([0x01])
        )

        await assertThrowsAssetError(
            .invalidResponse,
            try await coordinator.submit(
                replay,
                organizationID: Phase5OrgMediaFixture.organizationID
            )
        )

        let uploadCount = await repository.recordedCalls().filter {
            if case .upload = $0 { true } else { false }
        }.count
        XCTAssertEqual(uploadCount, 1)
    }

    func testExpiredReservationNeverOpensOrUploadsProtectedBody()
        async throws
    {
        let repository = Phase5OrgMediaRepositoryFake()
        await repository.setReservation(
            Phase5OrgMediaFixture.reservation(
                expiresAt: Phase5OrgMediaFixture.now
            )
        )
        let store = Phase5OrgMediaProtectedStoreFake()
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: repository,
            preparer: Phase5OrgImagePreparerFake(),
            protectedStore: store,
            uuids: Phase5OrgMediaUUIDSource([
                Phase5OrgMediaFixture.requestID
            ]),
            logger: Phase5OrgMediaLogRecorder(),
            now: { Phase5OrgMediaFixture.now }
        )
        let submission = try await coordinator.prepareSubmission(
            transferableData: Data([0x01]),
            kind: .gallery,
            altText: "Students broadcasting",
            collection: Phase5OrgMediaFixture.collection()
        )

        await assertThrowsAssetError(
            .reservationExpired,
            try await coordinator.submit(
                submission,
                organizationID: Phase5OrgMediaFixture.organizationID
            )
        )

        let repositoryCalls = await repository.recordedCalls()
        XCTAssertEqual(repositoryCalls.count, 1)
        guard case .reserve = repositoryCalls[0] else {
            return XCTFail("Expected reservation only")
        }
        let protectedStoreCalls = await store.recordedCalls()
        XCTAssertFalse(
            protectedStoreCalls.contains {
                if case .body = $0 { true } else { false }
            }
        )
        XCTAssertTrue(
            protectedStoreCalls.contains(
                .purge(
                    Phase5OrgMediaFixture.prepared().handle,
                    .expired
                )
            )
        )
    }

    func testEveryUploadTerminalOutcomePurgesTheExactHandle()
        async throws
    {
        let reasons: [OrganizationMediaPurgeReason] = [
            .uploaded,
            .reservationFailed,
            .uploadFailed,
            .validationFailed,
            .cancelled,
            .expired,
            .conflict,
            .discarded,
            .reselected,
            .viewTornDown,
        ]
        let store = Phase5OrgMediaProtectedStoreFake()
        let lifecycle = OrganizationMediaProtectedLifecycle(
            store: store
        )

        for reason in reasons {
            await lifecycle.finish(
                Phase5OrgMediaFixture.prepared(),
                reason: reason
            )
        }

        let purgeCalls = await store.recordedCalls().compactMap {
            call
                -> (
                    ProtectedOrganizationMediaHandle,
                    OrganizationMediaPurgeReason
                )? in
            guard case .purge(let handle, let reason) = call else {
                return nil
            }
            return (handle, reason)
        }
        XCTAssertEqual(
            purgeCalls.map(\.0),
            Array(
                repeating:
                    Phase5OrgMediaFixture.prepared().handle,
                count: reasons.count
            )
        )
        XCTAssertEqual(purgeCalls.map(\.1), reasons)
    }

    func testBackgroundAuthSignOutAndAccountDeletionPurgeAllBytes()
        async
    {
        let store = Phase5OrgMediaProtectedStoreFake()
        let purger = OrganizationMediaSensitiveCachePurger(store: store)
        let reasons: [SensitiveCachePurgeReason] = [
            .sceneBackgrounded,
            .authExpired,
            .signedOut,
            .accountDeleted,
        ]

        for reason in reasons {
            await purger.purge(reason: reason)
        }

        let purgeAllReasons: [SensitiveCachePurgeReason] =
            await store.recordedCalls().compactMap {
                call in
                guard case .purgeAll(let reason) = call else {
                    return nil
                }
                return reason
            }
        XCTAssertEqual(
            purgeAllReasons,
            reasons
        )
    }

    func testRootViewRoutesBackgroundThroughDedicatedMediaLifecycle()
        throws
    {
        let testFile = URL(fileURLWithPath: #filePath)
        let iosDirectory =
            testFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let source = try String(
            contentsOf: iosDirectory.appendingPathComponent(
                "Sources/BrownSync/App/RootView.swift"
            ),
            encoding: .utf8
        )

        XCTAssertTrue(
            source.contains("organizationMediaSceneLifecycle")
                && source.contains(".enqueueSceneBackground()")
        )
    }

    func testInvalidatorCancelsAndAwaitsOwnedUploadBeforePurgeAll()
        async throws
    {
        let repository = Phase5CancellableUploadRepository()
        let store = Phase5OrgMediaProtectedStoreFake()
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: repository,
            preparer: Phase5OrgImagePreparerFake(),
            protectedStore: store,
            uuids: Phase5OrgMediaUUIDSource([
                Phase5OrgMediaFixture.requestID
            ]),
            now: { Phase5OrgMediaFixture.now }
        )
        let submission = try await coordinator.prepareSubmission(
            transferableData: Data([0x01]),
            kind: .gallery,
            altText: "Students broadcasting",
            collection: Phase5OrgMediaFixture.collection()
        )
        let upload = Task {
            try await coordinator.submit(
                submission,
                organizationID: Phase5OrgMediaFixture.organizationID
            )
        }
        await repository.waitForUploadStart()
        let invalidator = ProtectedSessionInvalidator(
            tasks: coordinator,
            realtime: Phase5NoopRealtimeRemover(),
            navigation: Phase5NoopNavigationClearer(),
            caches: OrganizationMediaSensitiveCachePurger(store: store)
        )

        await invalidator.invalidate(reason: .signedOut)

        do {
            _ = try await upload.value
            XCTFail("Expected the owned upload to be cancelled")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        let terminalCalls = await store.recordedCalls().filter {
            switch $0 {
            case .purge, .purgeAll:
                return true
            case .stage, .body:
                return false
            }
        }
        XCTAssertEqual(
            terminalCalls,
            [
                .purge(submission.prepared.handle, .cancelled),
                .purgeAll(.signedOut),
            ]
        )
    }

    func testBackgroundWaitsForPreparationBeforePurgingAndNeverRestages()
        async throws
    {
        let repository = Phase5OrgMediaRepositoryFake()
        let preparer = Phase5GatedImagePreparer()
        let store = Phase5OrgMediaProtectedStoreFake()
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: repository,
            preparer: preparer,
            protectedStore: store,
            uuids: Phase5OrgMediaUUIDSource([
                Phase5OrgMediaFixture.requestID
            ])
        )
        let preparation = Task {
            try await coordinator.prepareSubmission(
                transferableData: Data([0x01]),
                kind: .gallery,
                altText: "Students broadcasting",
                collection: Phase5OrgMediaFixture.collection()
            )
        }
        await preparer.waitForStart()
        let lifecycle = OrganizationMediaSceneLifecycle(
            tasks: coordinator,
            purger: OrganizationMediaSensitiveCachePurger(store: store)
        )
        let background = Task {
            await lifecycle.didEnterBackground()
        }
        for _ in 0..<100 {
            await Task.yield()
        }
        let callsBeforePreparationFinished =
            await store.recordedCalls()

        XCTAssertFalse(
            callsBeforePreparationFinished.contains(
                .purgeAll(.sceneBackgrounded)
            ),
            "Background purge must await every owned preparation."
        )

        await preparer.finish()
        await background.value
        do {
            _ = try await preparation.value
            XCTFail("Expected the owned preparation to be cancelled")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        let terminalCalls = await store.recordedCalls()
        XCTAssertEqual(
            terminalCalls,
            [.purgeAll(.sceneBackgrounded)]
        )
    }

    func testBackgroundWaitsForReplayPreparationBeforePurging()
        async throws
    {
        let preparer = Phase5GatedImagePreparer()
        let store = Phase5OrgMediaProtectedStoreFake()
        let coordinator = OrganizationMediaUploadCoordinator(
            repository: Phase5OrgMediaRepositoryFake(),
            preparer: preparer,
            protectedStore: store,
            uuids: Phase5OrgMediaUUIDSource([
                Phase5OrgMediaFixture.requestID
            ])
        )
        let original = OrganizationMediaUploadSubmission(
            clientRequestID: Phase5OrgMediaFixture.requestID,
            kind: .gallery,
            altText: "Students broadcasting",
            prepared: Phase5OrgMediaFixture.prepared(),
            expectedOrganizationRevision: nil,
            expectedGalleryRevision: 7
        )
        let replay = Task {
            try await coordinator.prepareReplay(
                of: original,
                transferableData: Data([0x01])
            )
        }
        await preparer.waitForStart()
        let lifecycle = OrganizationMediaSceneLifecycle(
            tasks: coordinator,
            purger: OrganizationMediaSensitiveCachePurger(store: store)
        )
        let background = Task {
            await lifecycle.didEnterBackground()
        }
        for _ in 0..<100 {
            await Task.yield()
        }
        let callsBeforeReplayFinished =
            await store.recordedCalls()

        XCTAssertFalse(
            callsBeforeReplayFinished.contains(
                .purgeAll(.sceneBackgrounded)
            )
        )

        await preparer.finish()
        await background.value
        do {
            _ = try await replay.value
            XCTFail("Expected the owned replay preparation to be cancelled")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        let terminalCalls = await store.recordedCalls()
        XCTAssertEqual(
            terminalCalls,
            [.purgeAll(.sceneBackgrounded)]
        )
    }

    func testFileBackedStoreUsesOpaqueTemporaryNameAndDeletesIt()
        async throws
    {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "Phase5ProtectedStore-\(UUID().uuidString)",
                isDirectory: true
            )
        defer {
            try? FileManager.default.removeItem(at: root)
        }
        let store = FileBackedOrganizationMediaProtectedStore(
            rootDirectory: root,
            memoryThreshold: 0
        )
        let privateBytes = Data(
            repeating: 0xA5,
            count: 32_768
        )

        let prepared = try await store.stage(
            privateBytes,
            contentType: .jpeg
        )
        let paths = try FileManager.default.subpathsOfDirectory(
            atPath: root.path
        )

        XCTAssertFalse(paths.isEmpty)
        XCTAssertFalse(
            paths.contains {
                $0.localizedCaseInsensitiveContains("original")
                    || $0.localizedCaseInsensitiveContains(".jpg")
                    || $0.localizedCaseInsensitiveContains(".jpeg")
            }
        )
        let body = try await store.body(for: prepared)
        let restoredBytes = try await Data(
            collecting: body,
            upTo: privateBytes.count
        )
        XCTAssertEqual(
            restoredBytes,
            privateBytes
        )

        await store.purge(prepared.handle, reason: .uploaded)

        XCTAssertEqual(
            try FileManager.default.subpathsOfDirectory(
                atPath: root.path
            ),
            []
        )
    }

    func testFileBodyIsKnownLengthBoundedAndSinglePass()
        async throws
    {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "Phase5ProtectedStream-\(UUID().uuidString)",
                isDirectory: true
            )
        defer {
            try? FileManager.default.removeItem(at: root)
        }
        let store = FileBackedOrganizationMediaProtectedStore(
            rootDirectory: root,
            memoryThreshold: 0
        )
        let bytes = Data(repeating: 0xA5, count: 96 * 1_024)
        let prepared = try await store.stage(
            bytes,
            contentType: .jpeg
        )

        let body = try await store.body(for: prepared)

        XCTAssertEqual(body.length, .known(Int64(bytes.count)))
        XCTAssertEqual(body.iterationBehavior, .single)
        var restoredBytes = Data()
        for try await chunk in body {
            XCTAssertLessThanOrEqual(chunk.count, 64 * 1_024)
            restoredBytes.append(contentsOf: chunk)
        }
        XCTAssertEqual(restoredBytes, bytes)
        do {
            _ = try await Data(collecting: body, upTo: bytes.count)
            XCTFail("A protected file body must not be replayable")
        } catch {
            XCTAssertFalse(error is OrganizationAssetError)
        }
    }

    func testFileBodyUsesDemandDrivenReadsWithoutDetachedBuffering()
        throws
    {
        let testFile = URL(fileURLWithPath: #filePath)
        let iosDirectory =
            testFile
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let source = try String(
            contentsOf: iosDirectory.appendingPathComponent(
                "Sources/BrownSync/Media/OrganizationMediaProtectedStore.swift"
            ),
            encoding: .utf8
        )

        XCTAssertTrue(source.contains("ProtectedFileBodySequence"))
        XCTAssertFalse(source.contains("AsyncThrowingStream"))
        XCTAssertFalse(source.contains("Task.detached"))
    }

    func testPurgeFailureRetainsEntryForConfirmedRetry()
        async throws
    {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "Phase5ProtectedPurge-\(UUID().uuidString)",
                isDirectory: true
            )
        defer {
            try? FileManager.default.removeItem(at: root)
        }
        let fileManager = Phase5FailOnceFileManager()
        fileManager.failNextRemoval()
        let store = FileBackedOrganizationMediaProtectedStore(
            rootDirectory: root,
            memoryThreshold: 0,
            fileManager: fileManager
        )
        let bytes = Data(repeating: 0xC3, count: 32 * 1_024)
        let prepared = try await store.stage(bytes, contentType: .jpeg)

        let firstPurge = await store.purge(
            prepared.handle,
            reason: .cancelled
        )

        XCTAssertFalse(firstPurge)
        let body = try await store.body(for: prepared)
        let retainedBytes = try await Data(
            collecting: body,
            upTo: bytes.count
        )
        XCTAssertEqual(retainedBytes, bytes)

        let retry = await store.purge(
            prepared.handle,
            reason: .cancelled
        )
        XCTAssertTrue(retry)
        XCTAssertEqual(
            try FileManager.default.subpathsOfDirectory(
                atPath: root.path
            ),
            []
        )
    }

    func testPurgerLogsOnlyAfterConfirmedRemoval() async {
        let store = Phase5OrgMediaProtectedStoreFake(
            purgeAllResults: [false, true]
        )
        let logger = Phase5OrgMediaLogRecorder()
        let purger = OrganizationMediaSensitiveCachePurger(
            store: store,
            logger: logger
        )

        await purger.purge(reason: .signedOut)
        let eventsAfterFailure = await logger.events()
        XCTAssertEqual(eventsAfterFailure, [])

        await purger.purge(reason: .signedOut)
        let eventsAfterSuccess = await logger.events()
        XCTAssertEqual(
            eventsAfterSuccess,
            [.protectedBytesPurged(reason: .signedOut)]
        )
    }

    func testStartingAnotherStoreDoesNotDeleteAnOldLiveSession()
        async throws
    {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "Phase5ProtectedSessions-\(UUID().uuidString)",
                isDirectory: true
            )
        defer {
            try? FileManager.default.removeItem(at: root)
        }
        let first = FileBackedOrganizationMediaProtectedStore(
            rootDirectory: root,
            memoryThreshold: 0
        )
        let bytes = Data(repeating: 0x5A, count: 32 * 1_024)
        let prepared = try await first.stage(
            bytes,
            contentType: .jpeg
        )
        let firstSession = try XCTUnwrap(
            try FileManager.default.contentsOfDirectory(
                at: root,
                includingPropertiesForKeys: nil
            ).first
        )
        let orphan = root.appendingPathComponent(
            "abandoned-session",
            isDirectory: true
        )
        try FileManager.default.createDirectory(
            at: orphan,
            withIntermediateDirectories: true
        )
        let staleDate = Date(timeIntervalSince1970: 1_000)
        try FileManager.default.setAttributes(
            [.modificationDate: staleDate],
            ofItemAtPath: firstSession.path
        )
        try FileManager.default.setAttributes(
            [.modificationDate: staleDate],
            ofItemAtPath: orphan.path
        )

        _ = FileBackedOrganizationMediaProtectedStore(
            rootDirectory: root,
            memoryThreshold: 0,
            staleSessionAge: 60,
            now: staleDate.addingTimeInterval(120)
        )
        let body = try await first.body(for: prepared)
        let restoredBytes = try await Data(
            collecting: body,
            upTo: bytes.count
        )

        XCTAssertEqual(restoredBytes, bytes)
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: firstSession.path)
        )
        XCTAssertFalse(
            FileManager.default.fileExists(atPath: orphan.path)
        )
    }

    func testPrivacyStripperRemovesEXIFGPSAndOriginalDescription()
        async throws
    {
        let source = try makeImageData(
            typeIdentifier: UTType.jpeg.identifier,
            metadata: [
                kCGImagePropertyExifDictionary: [
                    kCGImagePropertyExifUserComment:
                        "private original filename.jpg"
                ],
                kCGImagePropertyGPSDictionary: [
                    kCGImagePropertyGPSLatitude: 41.8268,
                    kCGImagePropertyGPSLongitude: -71.4025,
                ],
                kCGImagePropertyTIFFDictionary: [
                    kCGImagePropertyTIFFImageDescription:
                        "private event details"
                ],
            ]
        )
        let preparer = ImageIOOrganizationImagePreparer()

        let output = try await preparer.prepare(
            transferableData: source,
            kind: .gallery
        )
        let properties = try imageProperties(output.bytes)

        XCTAssertNil(
            properties[kCGImagePropertyExifDictionary]
        )
        XCTAssertNil(
            properties[kCGImagePropertyGPSDictionary]
        )
        XCTAssertNil(
            properties[kCGImagePropertyTIFFDictionary]
        )
        XCTAssertEqual(output.contentType, .jpeg)
    }

    func testUnsupportedPhotosHEICIsLocallyConvertedToSanitizedJPEG()
        async throws
    {
        let source: Data
        do {
            source = try makeImageData(
                typeIdentifier: UTType.heic.identifier,
                metadata: [
                    kCGImagePropertyGPSDictionary: [
                        kCGImagePropertyGPSLatitude: 41.8268
                    ]
                ]
            )
        } catch {
            throw XCTSkip(
                "Runtime cannot encode the HEIC source fixture"
            )
        }
        let preparer = ImageIOOrganizationImagePreparer()

        let output = try await preparer.prepare(
            transferableData: source,
            kind: .avatar
        )

        XCTAssertEqual(output.contentType, .jpeg)
        XCTAssertNil(
            try imageProperties(output.bytes)[
                kCGImagePropertyGPSDictionary
            ]
        )
    }

    func testPreparationAppliesOrientationAndRasterizesIntoSRGB()
        async throws
    {
        let source = try makeImageData(
            typeIdentifier: UTType.jpeg.identifier,
            metadata: [
                kCGImagePropertyOrientation: 6
            ],
            width: 2,
            height: 3
        )
        let output = try await ImageIOOrganizationImagePreparer()
            .prepare(
                transferableData: source,
                kind: .gallery
            )
        let imageSource = try XCTUnwrap(
            CGImageSourceCreateWithData(
                output.bytes as CFData,
                nil
            )
        )
        let image = try XCTUnwrap(
            CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
        )

        XCTAssertEqual(image.width, 3)
        XCTAssertEqual(image.height, 2)
        XCTAssertEqual(image.colorSpace?.name, CGColorSpace.sRGB)
    }

    func testOperationalLogEventsCannotCarrySensitivePayloads()
        async throws
    {
        let logger = Phase5OrgMediaLogRecorder()
        await logger.record(
            .mutationFinished(
                kind: .mediaUpload,
                outcome: .conflict
            )
        )
        await logger.record(
            .protectedBytesPurged(reason: .accountDeleted)
        )

        let rendered = String(
            reflecting: await logger.events()
        )
        XCTAssertFalse(
            rendered.contains(
                Phase5OrgMediaFixture.requestID.uuidString
            )
        )
        XCTAssertFalse(
            rendered.contains("instagram.com")
        )
        XCTAssertFalse(rendered.contains("Students broadcasting"))
        XCTAssertFalse(rendered.contains("filename"))
        XCTAssertFalse(rendered.contains("Bearer"))
        XCTAssertFalse(rendered.contains("@brown.edu"))
    }

    private func makeImageData(
        typeIdentifier: String,
        metadata: [CFString: Any],
        width: Int = 2,
        height: Int = 2
    ) throws -> Data {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        var pixels = [UInt8](
            repeating: 0x62,
            count: width * height * 4
        )
        let context = pixels.withUnsafeMutableBytes { bytes in
            CGContext(
                data: bytes.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: colorSpace,
                bitmapInfo:
                    CGImageAlphaInfo.premultipliedLast.rawValue
            )
        }
        let image = try XCTUnwrap(context?.makeImage())
        let result = NSMutableData()
        let destination = try XCTUnwrap(
            CGImageDestinationCreateWithData(
                result,
                typeIdentifier as CFString,
                1,
                nil
            )
        )
        CGImageDestinationAddImage(
            destination,
            image,
            metadata as CFDictionary
        )
        guard CGImageDestinationFinalize(destination) else {
            throw Phase5OrgMediaTestFailure.unexpectedCall(
                "fixture encoding"
            )
        }
        return result as Data
    }

    private func imageProperties(
        _ data: Data
    ) throws -> [CFString: Any] {
        let source = try XCTUnwrap(
            CGImageSourceCreateWithData(
                data as CFData,
                nil
            )
        )
        return try XCTUnwrap(
            CGImageSourceCopyPropertiesAtIndex(
                source,
                0,
                nil
            ) as? [CFString: Any]
        )
    }
}

private actor Phase5OrgImagePreparerFake:
    OrganizationImagePreparing
{
    func prepare(
        transferableData _: Data,
        kind _: OrganizationMediaKind
    ) async throws -> PrivacyStrippedOrganizationImage {
        PrivacyStrippedOrganizationImage(
            bytes: Data([0xFF, 0xD8, 0xFF, 0xD9]),
            contentType: .jpeg
        )
    }
}

private actor Phase5GatedImagePreparer:
    OrganizationImagePreparing
{
    private var started = false
    private var startWaiters: [CheckedContinuation<Void, Never>] = []
    private var finishContinuation: CheckedContinuation<Void, Never>?

    func waitForStart() async {
        if started { return }
        await withCheckedContinuation { continuation in
            startWaiters.append(continuation)
        }
    }

    func finish() {
        finishContinuation?.resume()
        finishContinuation = nil
    }

    func prepare(
        transferableData _: Data,
        kind _: OrganizationMediaKind
    ) async throws -> PrivacyStrippedOrganizationImage {
        started = true
        for waiter in startWaiters {
            waiter.resume()
        }
        startWaiters.removeAll()
        await withCheckedContinuation { continuation in
            finishContinuation = continuation
        }
        return PrivacyStrippedOrganizationImage(
            bytes: Data([0xFF, 0xD8, 0xFF, 0xD9]),
            contentType: .jpeg
        )
    }
}

private final class Phase5FailOnceFileManager:
    FileManager,
    @unchecked Sendable
{
    private var shouldFailRemoval = false

    func failNextRemoval() {
        shouldFailRemoval = true
    }

    override func removeItem(at URL: URL) throws {
        if shouldFailRemoval {
            shouldFailRemoval = false
            throw CocoaError(.fileWriteUnknown)
        }
        try super.removeItem(at: URL)
    }
}

private actor Phase5CancellableUploadRepository:
    OrganizationMediaRepository
{
    private var uploadStarted = false
    private var uploadStartWaiters: [CheckedContinuation<Void, Never>] = []

    func waitForUploadStart() async {
        if uploadStarted { return }
        await withCheckedContinuation { continuation in
            uploadStartWaiters.append(continuation)
        }
    }

    func media(
        organizationID _: String,
        policy _: PublicLoadPolicy
    ) async throws -> PublicResource<OrganizationMediaCollection> {
        throw Phase5OrgMediaTestFailure.unexpectedCall("media")
    }

    func reserveUpload(
        organizationID _: String,
        command _: OrganizationMediaReservationCommand
    ) async throws -> OrganizationMediaReservation {
        Phase5OrgMediaFixture.reservation()
    }

    func uploadReserved(
        _: OrganizationMediaReservation,
        prepared _: PreparedOrganizationImage
    ) async throws -> OrganizationMediaUploadResult {
        uploadStarted = true
        for waiter in uploadStartWaiters {
            waiter.resume()
        }
        uploadStartWaiters.removeAll()
        try await Task.sleep(nanoseconds: 60_000_000_000)
        return Phase5OrgMediaFixture.uploadResult()
    }

    func deleteMedia(
        organizationID _: String,
        mediaID _: UUID,
        expectedRevision _: Int
    ) async throws -> OrganizationMediaMutationResult {
        throw Phase5OrgMediaTestFailure.unexpectedCall("delete")
    }

    func reorderGallery(
        organizationID _: String,
        mediaIDs _: [UUID],
        expectedGalleryRevision _: Int
    ) async throws -> OrganizationGalleryReorderResult {
        throw Phase5OrgMediaTestFailure.unexpectedCall("reorder")
    }
}

private struct Phase5NoopRealtimeRemover: RealtimeChannelRemoving {
    func removeRealtimeChannels() async {}
}

private struct Phase5NoopNavigationClearer: ProtectedNavigationClearing {
    func clearProtectedNavigation() async {}
}

private func assertThrowsAssetError<T>(
    _ expected: OrganizationAssetError,
    _ expression: @autoclosure () async throws -> T,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail(
            "Expected \(expected)",
            file: file,
            line: line
        )
    } catch {
        XCTAssertEqual(
            error as? OrganizationAssetError,
            expected,
            file: file,
            line: line
        )
    }
}

private func assertCoordinatorIsClosed(
    _ coordinator: OrganizationMediaUploadCoordinator,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await coordinator.prepareSubmission(
            transferableData: Data([0x01]),
            kind: .gallery,
            altText: "Students broadcasting",
            collection: Phase5OrgMediaFixture.collection()
        )
        XCTFail(
            "Expected protected media session to remain closed",
            file: file,
            line: line
        )
    } catch {
        XCTAssertTrue(
            error is CancellationError,
            file: file,
            line: line
        )
    }
}
