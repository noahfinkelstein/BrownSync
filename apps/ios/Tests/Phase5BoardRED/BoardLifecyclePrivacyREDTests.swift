import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

final class BoardLifecyclePrivacyREDTests: XCTestCase {
    @MainActor
    func testProductionCompositionUsesOneProtectedRepositoryAndEphemeralSession() {
        let dependencies = BoardDependencies.production(
            baseURL: URL(string: "https://api.example.invalid")!,
            tokenProvider: Phase5BoardStaticTokenProvider()
        )

        XCTAssertTrue(
            dependencies.memberRepository as? WorkerBoardRepository
                === dependencies.repository
        )
        XCTAssertTrue(
            dependencies.moderationRepository
                as? WorkerBoardRepository
                === dependencies.repository
        )
        XCTAssertTrue(
            dependencies.ownerRepository as? WorkerBoardRepository
                === dependencies.repository
        )
        XCTAssertTrue(dependencies.repository.cache === dependencies.cache)

        let configuration = dependencies.networkSession.configuration
        XCTAssertNil(configuration.urlCache)
        XCTAssertEqual(
            configuration.requestCachePolicy,
            .reloadIgnoringLocalCacheData
        )
        XCTAssertNil(configuration.httpCookieStorage)
        XCTAssertNil(configuration.urlCredentialStorage)
        XCTAssertFalse(configuration.httpShouldSetCookies)
        XCTAssertNil(configuration.identifier)
    }

    @MainActor
    func testBackgroundEpochRejectsDelayedAdmittedLoadAfterSameOwnerReactivation()
        async
    {
        let harness = makeLeasedMemberHarness()
        await harness.lifecycle.activate(
            userID: Phase5BoardFixture.actorID
        )
        await harness.lifecycle.activateForeground(
            userID: Phase5BoardFixture.actorID
        )
        let staleRequest = harness.model.makeLoadRequest(
            authState: admitted
        )

        harness.lifecycle.enqueueSceneBackground()
        await harness.lifecycle.waitForIdle()
        await harness.lifecycle.activateForeground(
            userID: Phase5BoardFixture.actorID
        )
        await harness.model.load(request: staleRequest)

        XCTAssertEqual(harness.model.state, .authenticationRequired)
        let records = await harness.transport.records()
        let snapshot = await harness.cache.snapshot()
        XCTAssertEqual(records.count, 0)
        XCTAssertEqual(snapshot, .empty)
    }

    @MainActor
    func testSignOutRejectsDelayedAdmittedLoad() async {
        let harness = makeLeasedMemberHarness()
        await harness.lifecycle.activate(
            userID: Phase5BoardFixture.actorID
        )
        await harness.lifecycle.activateForeground(
            userID: Phase5BoardFixture.actorID
        )
        let staleRequest = harness.model.makeLoadRequest(
            authState: admitted
        )

        await harness.lifecycle.purge(reason: .signedOut)
        await harness.model.load(request: staleRequest)

        XCTAssertEqual(harness.model.state, .authenticationRequired)
        let records = await harness.transport.records()
        let snapshot = await harness.cache.snapshot()
        XCTAssertEqual(records.count, 0)
        XCTAssertEqual(snapshot, .empty)
    }

    @MainActor
    func testLeaseOwnerMismatchRejectsDelayedAdmittedLoad() async {
        let harness = makeLeasedMemberHarness()
        await harness.lifecycle.activate(
            userID: Phase5BoardFixture.actorID
        )
        await harness.lifecycle.activateForeground(
            userID: Phase5BoardFixture.actorID
        )
        let staleRequest = harness.model.makeLoadRequest(
            authState: admitted
        )

        await harness.lifecycle.activate(
            userID: UUID(
                uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB"
            )!
        )
        await harness.model.load(request: staleRequest)

        XCTAssertEqual(harness.model.state, .authenticationRequired)
        let records = await harness.transport.records()
        let snapshot = await harness.cache.snapshot()
        XCTAssertEqual(records.count, 0)
        XCTAssertEqual(snapshot, .empty)
    }

    @MainActor
    func testCurrentOwnerForegroundLeaseAllowsAdmittedLoad() async {
        let harness = makeLeasedMemberHarness()
        await harness.transport.enqueue(
            operationID: "getBoardStatus",
            status: 200,
            json: Phase5BoardFixture.statusJSON
        )
        await harness.transport.enqueue(
            operationID: "getBoardFeed",
            status: 200,
            json: Phase5BoardFixture.feedJSON
        )
        await harness.lifecycle.activate(
            userID: Phase5BoardFixture.actorID
        )
        await harness.lifecycle.activateForeground(
            userID: Phase5BoardFixture.actorID
        )
        let request = harness.model.makeLoadRequest(
            authState: admitted
        )

        await harness.model.load(request: request)

        XCTAssertTrue(harness.model.state.isLoaded)
        let records = await harness.transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["getBoardStatus", "getBoardFeed"]
        )
        let snapshot = await harness.cache.snapshot()
        XCTAssertNotNil(snapshot.status)
        XCTAssertNotNil(snapshot.feed)
    }

    @MainActor
    func testOwnerSwitchPurgesPublishedStateBeforeNewLeaseIsUsable()
        async
    {
        let harness = makeLeasedMemberHarness()
        await harness.transport.enqueue(
            operationID: "getBoardStatus",
            status: 200,
            json: Phase5BoardFixture.statusJSON
        )
        await harness.transport.enqueue(
            operationID: "getBoardFeed",
            status: 200,
            json: Phase5BoardFixture.feedJSON
        )
        await harness.lifecycle.activate(
            userID: Phase5BoardFixture.actorID
        )
        await harness.lifecycle.activateForeground(
            userID: Phase5BoardFixture.actorID
        )
        let request = harness.model.makeLoadRequest(
            authState: admitted
        )
        await harness.model.load(request: request)
        XCTAssertTrue(harness.model.state.isLoaded)

        let newOwnerID = UUID(
            uuidString: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB"
        )!
        await harness.lifecycle.activate(userID: newOwnerID)

        XCTAssertEqual(harness.model.state, .authenticationRequired)
        let snapshot = await harness.cache.snapshot()
        XCTAssertEqual(snapshot, .empty)
        let newOwnerRequest = harness.model.makeLoadRequest(
            authState: .admitted(
                AdmittedIdentity(
                    id: newOwnerID,
                    email: "new-owner@brown.edu"
                )
            )
        )
        XCTAssertNotNil(newOwnerRequest.leaseToken)
    }

    @MainActor
    func testSceneBackgroundImmediatelyHidesEveryBoardSurfaceThenPurgesCache()
        async
    {
        let cache = BoardMemoryCache()
        let models = makeLoadedModels(cache: cache)
        await models.member.load(authState: admitted)
        await models.moderation.load(authState: admitted)
        await models.owner.load(authState: admitted)
        await Self.populate(cache)
        XCTAssertTrue(models.member.state.isLoaded)
        XCTAssertTrue(models.moderation.state.isLoaded)
        XCTAssertTrue(models.owner.state.isLoaded)

        let lifecycle = BoardSessionLifecycle(
            cache: cache,
            member: models.member,
            moderation: models.moderation,
            owner: models.owner
        )
        lifecycle.enqueueSceneBackground()

        XCTAssertEqual(models.member.state, .loading)
        XCTAssertEqual(models.moderation.state, .loading)
        XCTAssertEqual(models.owner.state, .loading)

        await lifecycle.waitForIdle()

        XCTAssertEqual(models.member.state, .authenticationRequired)
        XCTAssertEqual(
            models.moderation.state,
            .authenticationRequired
        )
        XCTAssertEqual(models.owner.state, .authenticationRequired)
        let snapshot = await cache.snapshot()
        XCTAssertEqual(snapshot, .empty)
    }

    @MainActor
    func testAuthInvalidationPurgesEveryPublishedBoardStateAndCachePartition()
        async
    {
        let reasons: [SensitiveCachePurgeReason] = [
            .authExpired,
            .signedOut,
            .accountDeleted,
        ]

        for reason in reasons {
            let cache = BoardMemoryCache()
            let models = makeLoadedModels(cache: cache)
            await models.member.load(authState: admitted)
            await models.moderation.load(authState: admitted)
            await models.owner.load(authState: admitted)
            await Self.populate(cache)
            let lifecycle = BoardSessionLifecycle(
                cache: cache,
                member: models.member,
                moderation: models.moderation,
                owner: models.owner
            )

            await lifecycle.purge(reason: reason)

            XCTAssertEqual(
                models.member.state,
                .authenticationRequired,
                "\(reason)"
            )
            XCTAssertEqual(
                models.moderation.state,
                .authenticationRequired,
                "\(reason)"
            )
            XCTAssertEqual(
                models.owner.state,
                .authenticationRequired,
                "\(reason)"
            )
            let snapshot = await cache.snapshot()
            XCTAssertEqual(snapshot, .empty, "\(reason)")
        }
    }

    func testFreshCacheCannotRecoverAnyBoardPartition() async {
        let first = BoardMemoryCache()
        await Self.populate(first)
        let populated = await first.snapshot()
        XCTAssertNotEqual(populated, .empty)
        XCTAssertNotNil(populated.status)
        XCTAssertNotNil(populated.feed)
        XCTAssertNotNil(populated.thread)
        XCTAssertNotNil(populated.ownContent)
        XCTAssertNotNil(populated.moderationQueue)
        XCTAssertNotNil(populated.config)
        XCTAssertNotNil(populated.moderators)

        let fresh = BoardMemoryCache()
        let freshSnapshot = await fresh.snapshot()
        XCTAssertEqual(freshSnapshot, .empty)
    }

    func testBackgroundAuthExpirySignOutAndAccountDeletionPurgeEverything()
        async
    {
        let cache = BoardMemoryCache()
        let reasons: [BoardCachePurgeReason] = [
            .sceneBackgrounded,
            .authExpired,
            .signedOut,
            .accountDeleted,
        ]

        for reason in reasons {
            await Self.populate(cache)
            await cache.purge(reason: reason)
            let snapshot = await cache.snapshot()
            XCTAssertEqual(
                snapshot,
                .empty,
                "\(reason)"
            )
        }
    }

    func testSharedMutationBoundaryPurgesOnSuccessAndFailure() async throws {
        let transport = Phase5BoardTransport()
        let successJSON =
            """
            {
              "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
              "revision":1,
              "replayed":false
            }
            """
        await transport.enqueue(
            operationID: "createBoardPost",
            status: 201,
            json: successJSON
        )
        await transport.enqueue(
            operationID: "createBoardPost",
            status: 429,
            json:
                """
                {
                  "error":{
                    "code":"rate_limited",
                    "message":"Too many board requests."
                  }
                }
                """
        )
        let cache = BoardMemoryCache()
        let repository = WorkerBoardRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.example.invalid")!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            cache: cache,
            logger: Phase5BoardLogRecorder()
        )
        let command = BoardCreatePostCommand(
            clientRequestID: Phase5BoardFixture.requestID,
            title: nil,
            body: "A post"
        )

        await Self.populate(cache)
        _ = try await repository.createPost(command)
        let successSnapshot = await cache.snapshot()
        XCTAssertEqual(successSnapshot, .empty)

        await Self.populate(cache)
        do {
            _ = try await repository.createPost(command)
            XCTFail("Expected quota failure.")
        } catch {
            XCTAssertEqual(error as? BoardError, .quotaLimited)
        }
        let failureSnapshot = await cache.snapshot()
        XCTAssertEqual(failureSnapshot, .empty)
    }

    func testPurgeWinsAgainstAReadThatFinishesAfterThePurge() async throws {
        let transport = Phase5BoardTransport()
        await transport.enqueue(
            operationID: "getBoardStatus",
            status: 200,
            json: Phase5BoardFixture.statusJSON
        )
        let gate = Phase5BoardGate()
        let cache = BoardMemoryCache()
        let repository = WorkerBoardRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.example.invalid")!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            cache: cache,
            logger: Phase5BoardBlockingLogSink(gate: gate)
        )
        await Self.populate(cache)

        let read = Task {
            try await repository.status()
        }
        await gate.waitUntilSuspended()
        await cache.purge(reason: .signedOut)
        await gate.release()
        _ = try await read.value

        let snapshot = await cache.snapshot()
        XCTAssertEqual(snapshot, .empty)
    }

    func testEveryPartitionRejectsAllWritesFromStaleGenerations() async {
        let cache = BoardMemoryCache()
        let member = await cache.writeToken(for: .member)
        let moderation = await cache.writeToken(for: .moderation)
        let owner = await cache.writeToken(for: .owner)
        await cache.purge(reason: .signedOut)

        let status = await cache.replaceStatus(
            Phase5BoardFixture.status(),
            ifCurrent: member
        )
        let feed = await cache.replaceFeed(
            BoardFeedPage(posts: [], next: nil),
            ifCurrent: member
        )
        let thread = await cache.replaceThread(
            BoardThreadPage(
                post: Phase5BoardFixture.post(),
                comments: [],
                next: nil
            ),
            ifCurrent: member
        )
        let own = await cache.replaceOwnContent(
            BoardOwnContentPage(
                items: [Phase5BoardFixture.ownContentItem()],
                next: nil
            ),
            ifCurrent: member
        )
        let queue = await cache.replaceModerationQueue(
            BoardModerationQueuePage(items: [], next: nil),
            ifCurrent: moderation
        )
        let config = await cache.replaceConfig(
            BoardConfig(
                enabled: true,
                autoHideThreshold: 3,
                updatedAt: Phase5BoardFixture.baseDate
            ),
            ifCurrent: owner
        )
        let moderators = await cache.replaceModerators(
            BoardModeratorPage(moderators: [], next: nil),
            ifCurrent: owner
        )

        XCTAssertEqual(
            [status, feed, thread, own, queue, config, moderators],
            Array(repeating: false, count: 7)
        )
        let snapshot = await cache.snapshot()
        XCTAssertEqual(snapshot, .empty)
    }

    func testMutationPurgesBeforeAwaitingTheLogSink() async throws {
        let transport = Phase5BoardTransport()
        await transport.enqueue(
            operationID: "createBoardPost",
            status: 201,
            json:
                """
                {
                  "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                  "revision":1,
                  "replayed":false
                }
                """
        )
        let gate = Phase5BoardGate()
        let cache = BoardMemoryCache()
        let repository = WorkerBoardRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.example.invalid")!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            cache: cache,
            logger: Phase5BoardBlockingLogSink(gate: gate)
        )
        await Self.populate(cache)

        let mutation = Task {
            try await repository.createPost(
                BoardCreatePostCommand(
                    clientRequestID: Phase5BoardFixture.requestID,
                    title: nil,
                    body: "A post"
                )
            )
        }
        await gate.waitUntilSuspended()
        let snapshotWhileLogging = await cache.snapshot()
        XCTAssertEqual(snapshotWhileLogging, .empty)
        await gate.release()
        _ = try await mutation.value
    }

    func testFailedMutationPurgesBeforeAwaitingTheLogSink() async {
        let transport = Phase5BoardTransport()
        await transport.enqueue(
            operationID: "createBoardPost",
            status: 429,
            json:
                """
                {
                  "error":{
                    "code":"rate_limited",
                    "message":"Too many board requests."
                  }
                }
                """
        )
        let gate = Phase5BoardGate()
        let cache = BoardMemoryCache()
        let repository = WorkerBoardRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.example.invalid")!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            cache: cache,
            logger: Phase5BoardBlockingLogSink(gate: gate)
        )
        await Self.populate(cache)

        let mutation = Task {
            try await repository.createPost(
                BoardCreatePostCommand(
                    clientRequestID: Phase5BoardFixture.requestID,
                    title: nil,
                    body: "A post"
                )
            )
        }
        await gate.waitUntilSuspended()
        let snapshotWhileLogging = await cache.snapshot()
        XCTAssertEqual(snapshotWhileLogging, .empty)
        await gate.release()
        do {
            _ = try await mutation.value
            XCTFail("Expected quota failure.")
        } catch {
            XCTAssertEqual(error as? BoardError, .quotaLimited)
        }
    }

    func testAuthorityFailurePurgesBeforeAwaitingTheLogSink() async {
        let transport = Phase5BoardTransport()
        await transport.enqueue(
            operationID: "getBoardModerationQueue",
            status: 403,
            json:
                """
                {
                  "error":{
                    "code":"board_forbidden",
                    "message":"Moderator access required."
                  }
                }
                """
        )
        let gate = Phase5BoardGate()
        let cache = BoardMemoryCache()
        let repository = WorkerBoardRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.example.invalid")!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            cache: cache,
            logger: Phase5BoardBlockingLogSink(gate: gate)
        )
        await Self.populate(cache)

        let read = Task {
            try await repository.moderationQueue(
                page: BoardPageRequest()
            )
        }
        await gate.waitUntilSuspended()
        let snapshotWhileLogging = await cache.snapshot()
        XCTAssertNil(snapshotWhileLogging.moderationQueue)
        await gate.release()
        do {
            _ = try await read.value
            XCTFail("Expected authority failure.")
        } catch {
            XCTAssertEqual(error as? BoardError, .authorityRequired)
        }
    }

    func testCancelledMutationStillPurgesEveryPartition() async {
        let transport = Phase5BoardCancellationTransport()
        let cache = BoardMemoryCache()
        let repository = WorkerBoardRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.example.invalid")!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            cache: cache,
            logger: Phase5BoardLogRecorder()
        )
        await Self.populate(cache)

        let mutation = Task {
            try await repository.createPost(
                BoardCreatePostCommand(
                    clientRequestID: Phase5BoardFixture.requestID,
                    title: nil,
                    body: "A post"
                )
            )
        }
        await transport.waitUntilStarted()
        mutation.cancel()
        do {
            _ = try await mutation.value
            XCTFail("Expected cancellation.")
        } catch is CancellationError {
            // Expected.
        } catch {
            XCTFail("Expected CancellationError, got \(error).")
        }

        let snapshot = await cache.snapshot()
        XCTAssertEqual(snapshot, .empty)
    }

    func testEveryMutationKindUsesTheSameFullCachePurgeContract() async {
        let expected: Set<BoardMutationKind> = [
            .createPost,
            .editPost,
            .deletePost,
            .createComment,
            .editComment,
            .deleteComment,
            .vote,
            .report,
            .appealContent,
            .appealBan,
            .moderationDecision,
            .createBan,
            .revokeBan,
            .appealDecision,
            .updateConfig,
            .upsertModerator,
            .removeModerator,
        ]
        XCTAssertEqual(Set(BoardMutationKind.allCases), expected)

        let cache = BoardMemoryCache()
        for kind in expected {
            await Self.populate(cache)
            await cache.purge(reason: .mutation(kind))
            let snapshot = await cache.snapshot()
            XCTAssertEqual(snapshot, .empty, "\(kind)")
        }
    }

    func testBoardNetworkConfigurationHasNoPersistentHTTPState() {
        let configuration = BoardNetworkPolicy.makeConfiguration()

        XCTAssertNil(configuration.urlCache)
        XCTAssertEqual(
            configuration.requestCachePolicy,
            .reloadIgnoringLocalCacheData
        )
        XCTAssertNil(configuration.httpCookieStorage)
        XCTAssertNil(configuration.urlCredentialStorage)
        XCTAssertNil(configuration.identifier)
    }

    func testSafeLogEventsCannotCarryIDsBodiesAliasesOrRawErrors()
        async throws
    {
        let transport = Phase5BoardTransport()
        let secret =
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        await transport.enqueue(
            operationID: "getBoardStatus",
            status: 503,
            json:
                """
                {
                  "error":{
                    "code":"board_service_unavailable",
                    "message":"\(secret)"
                  }
                }
                """
        )
        let logger = Phase5BoardLogRecorder()
        let repository = WorkerBoardRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.example.invalid")!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            cache: BoardMemoryCache(),
            logger: logger
        )

        do {
            _ = try await repository.status()
            XCTFail("Expected unavailable.")
        } catch {
            XCTAssertEqual(error as? BoardError, .unavailable)
        }

        let events = await logger.events()
        XCTAssertEqual(
            events,
            [
                BoardLogEvent(
                    operation: .status,
                    outcome: .failed(.unavailable)
                )
            ]
        )
        let reflected = String(reflecting: events)
        XCTAssertFalse(reflected.contains(secret))
        XCTAssertFalse(reflected.contains("member@brown.edu"))
        XCTAssertFalse(
            reflected.contains(
                Phase5BoardFixture.actorID.uuidString.lowercased()
            )
        )
    }

    func testEverySemanticStateHasTextSymbolAndAccessibilityMeaning() {
        for state in BoardSemanticState.allCases {
            let presentation = BoardStatePresentation.make(for: state)
            XCTAssertFalse(presentation.title.isEmpty, "\(state)")
            XCTAssertFalse(presentation.message.isEmpty, "\(state)")
            XCTAssertFalse(presentation.systemImage.isEmpty, "\(state)")
            XCTAssertFalse(
                presentation.accessibilityLabel.isEmpty,
                "\(state)"
            )
        }
    }

    private static func populate(_ cache: BoardMemoryCache) async {
        await cache.replaceStatus(Phase5BoardFixture.status())
        await cache.replaceFeed(
            BoardFeedPage(posts: [], next: nil)
        )
        await cache.replaceThread(
            BoardThreadPage(
                post: Phase5BoardFixture.post(),
                comments: [],
                next: nil
            )
        )
        await cache.replaceOwnContent(
            BoardOwnContentPage(
                items: [Phase5BoardFixture.ownContentItem()],
                next: nil
            )
        )
        await cache.replaceModerationQueue(
            BoardModerationQueuePage(items: [], next: nil)
        )
        await cache.replaceConfig(
            BoardConfig(
                enabled: true,
                autoHideThreshold: 3,
                updatedAt: Phase5BoardFixture.baseDate
            )
        )
        await cache.replaceModerators(
            BoardModeratorPage(moderators: [], next: nil)
        )
    }

    @MainActor
    private func makeLeasedMemberHarness() -> (
        lifecycle: BoardSessionLifecycle,
        model: BoardViewModel,
        cache: BoardMemoryCache,
        transport: Phase5BoardTransport
    ) {
        let lease = BoardSessionLease()
        let cache = BoardMemoryCache(lease: lease)
        let transport = Phase5BoardTransport()
        let repository = WorkerBoardRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.example.invalid")!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            cache: cache,
            logger: Phase5BoardLogRecorder(),
            lease: lease
        )
        let model = BoardViewModel(
            repository: repository,
            cache: cache,
            requestIDs: Phase5BoardUUIDSource(
                [Phase5BoardFixture.requestID]
            ),
            lease: lease
        )
        let moderation = BoardModerationViewModel(
            repository: Phase5BoardModerationRepositoryFake(),
            cache: cache,
            requestIDs: Phase5BoardUUIDSource(
                [Phase5BoardFixture.requestID]
            ),
            lease: lease
        )
        let owner = BoardOwnerViewModel(
            repository: Phase5BoardLoadedOwnerRepositoryFake(),
            cache: cache,
            lease: lease
        )
        return (
            BoardSessionLifecycle(
                cache: cache,
                member: model,
                moderation: moderation,
                owner: owner,
                lease: lease
            ),
            model,
            cache,
            transport
        )
    }

    @MainActor
    private func makeLoadedModels(
        cache: BoardMemoryCache
    ) -> (
        member: BoardViewModel,
        moderation: BoardModerationViewModel,
        owner: BoardOwnerViewModel
    ) {
        (
            BoardViewModel(
                repository: Phase5BoardRepositoryFake(),
                cache: cache,
                requestIDs: Phase5BoardUUIDSource(
                    [Phase5BoardFixture.requestID]
                )
            ),
            BoardModerationViewModel(
                repository: Phase5BoardModerationRepositoryFake(),
                cache: cache,
                requestIDs: Phase5BoardUUIDSource(
                    [Phase5BoardFixture.requestID]
                )
            ),
            BoardOwnerViewModel(
                repository: Phase5BoardLoadedOwnerRepositoryFake(),
                cache: cache
            )
        )
    }

    private var admitted: AuthState {
        .admitted(
            AdmittedIdentity(
                id: Phase5BoardFixture.actorID,
                email: "member@brown.edu"
            )
        )
    }
}

private struct Phase5BoardStaticTokenProvider: AccessTokenProviding {
    func accessToken() async throws -> String {
        "token"
    }
}

private actor Phase5BoardLoadedOwnerRepositoryFake:
    BoardOwnerRepository
{
    func config() async throws -> BoardConfig {
        BoardConfig(
            enabled: true,
            autoHideThreshold: 3,
            updatedAt: Phase5BoardFixture.baseDate
        )
    }

    func updateConfig(
        _: BoardConfigUpdateCommand
    ) async throws -> BoardConfigMutationResult {
        throw Phase5BoardTestFailure.unexpectedCall("updateConfig")
    }

    func moderators(
        page _: BoardPageRequest
    ) async throws -> BoardModeratorPage {
        BoardModeratorPage(moderators: [], next: nil)
    }

    func upsertModerator(
        _: BoardModeratorUpsertCommand
    ) async throws -> BoardModeratorMutationResult {
        throw Phase5BoardTestFailure.unexpectedCall("upsertModerator")
    }

    func removeModerator(
        userID _: UUID
    ) async throws -> BoardModeratorMutationResult {
        throw Phase5BoardTestFailure.unexpectedCall("removeModerator")
    }
}

extension BoardScreenState {
    fileprivate var isLoaded: Bool {
        if case .loaded = self {
            return true
        }
        return false
    }
}

extension BoardModerationScreenState {
    fileprivate var isLoaded: Bool {
        if case .loaded = self {
            return true
        }
        return false
    }
}

extension BoardOwnerScreenState {
    fileprivate var isLoaded: Bool {
        if case .loaded = self {
            return true
        }
        return false
    }
}
