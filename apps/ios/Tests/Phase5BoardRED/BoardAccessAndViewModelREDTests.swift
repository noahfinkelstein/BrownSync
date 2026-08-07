import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class BoardAccessAndViewModelREDTests: XCTestCase {
    func testBoardRouteIsAdmittedOnlyAndSignedOutAttemptDoesNotMutatePaths() {
        let navigator = AppNavigator()

        XCTAssertEqual(
            navigator.route(.board, in: .me, access: .signedOut),
            .authenticationRequired(.me)
        )
        XCTAssertTrue(navigator.mePath.isEmpty)

        XCTAssertEqual(
            navigator.route(.board, in: .me, access: .admitted),
            .routed
        )
        XCTAssertEqual(navigator.mePath, [.board])
    }

    func testBoardHasNoPublicOrSignedOutDeepLinkPreview() async {
        let coordinator = DeepLinkCoordinator(
            googleCallbacks: Phase5BoardGoogleCallbackFake(),
            supabaseCallbacks: Phase5BoardSupabaseCallbackFake(),
            supabaseCallback: nil,
            contentScheme: "brownsync"
        )
        let values = [
            "brownsync://board/feed",
            "brownsync://board/\(Phase5BoardFixture.postID)",
            "https://brownsync.invalid/board/\(Phase5BoardFixture.postID)",
            "brownsync://board/feed?cursor=\(Phase5BoardFixture.cursor)",
        ]

        for value in values {
            let result = await coordinator.handle(URL(string: value)!)
            XCTAssertEqual(result, .rejected, value)
        }
    }

    func testSignedOutAndAuthenticatingStatesNeverReachRepository()
        async
    {
        let repository = Phase5BoardRepositoryFake()
        let model = BoardViewModel(
            repository: repository,
            cache: BoardMemoryCache(),
            requestIDs: Phase5BoardUUIDSource(
                [Phase5BoardFixture.requestID]
            )
        )

        await model.load(authState: .signedOut)
        XCTAssertEqual(model.state, .authenticationRequired)
        await model.load(authState: .authenticating)
        XCTAssertEqual(model.state, .authenticationRequired)

        let calls = await repository.recordedCalls()
        XCTAssertTrue(calls.isEmpty)
    }

    func testAdmittedLoadShowsDisclosuresBeforeFetchingFeed() async {
        let repository = Phase5BoardRepositoryFake()
        let model = BoardViewModel(
            repository: repository,
            cache: BoardMemoryCache(),
            requestIDs: Phase5BoardUUIDSource(
                [Phase5BoardFixture.requestID]
            )
        )

        await model.load(
            authState: .admitted(
                AdmittedIdentity(
                    id: Phase5BoardFixture.actorID,
                    email: "member@brown.edu"
                )
            )
        )

        guard case .loaded(let value) = model.state else {
            return XCTFail("Expected loaded Board.")
        }
        XCTAssertEqual(
            value.status.privacyNotice,
            Phase5BoardFixture.privacyNotice
        )
        XCTAssertEqual(
            value.status.edgeMetadataNotice,
            Phase5BoardFixture.edgeNotice
        )
        let calls = await repository.recordedCalls()
        XCTAssertEqual(calls, ["status", "feed:nil:25"])
    }

    func testKillSwitchStopsBeforeFeedAndUsesTextPlusSymbolState()
        async
    {
        let repository = Phase5BoardRepositoryFake()
        await repository.setStatus(
            Phase5BoardFixture.status(enabled: false)
        )
        let model = BoardViewModel(
            repository: repository,
            cache: BoardMemoryCache(),
            requestIDs: Phase5BoardUUIDSource(
                [Phase5BoardFixture.requestID]
            )
        )

        await model.load(
            authState: .admitted(
                AdmittedIdentity(
                    id: Phase5BoardFixture.actorID,
                    email: "member@brown.edu"
                )
            )
        )

        guard case .disabled(let presentation) = model.state else {
            return XCTFail("Expected kill-switch state.")
        }
        assertAccessible(presentation)
        let calls = await repository.recordedCalls()
        XCTAssertEqual(calls, ["status"])
    }

    func testBannedMemberCanReadDeleteAndAppealButCannotCreateVoteOrReport()
        async
    {
        let repository = Phase5BoardRepositoryFake()
        await repository.setStatus(
            Phase5BoardFixture.status(banned: true)
        )
        let model = BoardViewModel(
            repository: repository,
            cache: BoardMemoryCache(),
            requestIDs: Phase5BoardUUIDSource(
                [Phase5BoardFixture.requestID]
            )
        )

        await model.load(
            authState: .admitted(
                AdmittedIdentity(
                    id: Phase5BoardFixture.actorID,
                    email: "member@brown.edu"
                )
            )
        )

        guard case .loaded(let value) = model.state else {
            return XCTFail("Expected readable banned state.")
        }
        XCTAssertTrue(value.permissions.canRead)
        XCTAssertTrue(value.permissions.canDeleteOwnContent)
        XCTAssertTrue(value.permissions.canAppeal)
        XCTAssertFalse(value.permissions.canCreate)
        XCTAssertFalse(value.permissions.canVote)
        XCTAssertFalse(value.permissions.canReport)
        assertAccessible(value.availability)
    }

    func testQuotaFailureUsesOneStableRequestIDAndAccessibleState()
        async
    {
        let repository = Phase5BoardRepositoryFake()
        await repository.failCreate(with: .quotaLimited)
        let requestIDs = Phase5BoardUUIDSource(
            [Phase5BoardFixture.requestID]
        )
        let model = BoardViewModel(
            repository: repository,
            cache: BoardMemoryCache(),
            requestIDs: requestIDs
        )
        await model.load(
            authState: .admitted(
                AdmittedIdentity(
                    id: Phase5BoardFixture.actorID,
                    email: "member@brown.edu"
                )
            )
        )

        await model.createPost(title: nil, body: "A post")

        guard case .quotaLimited(let presentation) = model.state else {
            return XCTFail("Expected quota state.")
        }
        assertAccessible(presentation)
        let requestCount = await requestIDs.requestCount()
        XCTAssertEqual(requestCount, 1)
        let calls = await repository.recordedCalls()
        XCTAssertEqual(
            calls.last,
            "create:\(Phase5BoardFixture.requestID.uuidString.lowercased())"
        )
    }

    func testMutationInvalidatesAnOverlappingPaginationResult() async {
        let repository = Phase5BoardRepositoryFake()
        let cursor = BoardCursor(
            rawValue: Phase5BoardFixture.cursor
        )!
        await repository.setFeed(
            BoardFeedPage(posts: [], next: cursor)
        )
        let gate = Phase5BoardGate()
        await repository.setPaginatedFeed(
            BoardFeedPage(
                posts: [
                    Phase5BoardFixture.post(
                        id: Phase5BoardFixture.moderatorID,
                        body: "Stale page"
                    )
                ],
                next: nil
            ),
            gate: gate
        )
        let cache = BoardMemoryCache()
        let model = BoardViewModel(
            repository: repository,
            cache: cache,
            requestIDs: Phase5BoardUUIDSource(
                [Phase5BoardFixture.requestID]
            )
        )
        await model.load(
            authState: .admitted(
                AdmittedIdentity(
                    id: Phase5BoardFixture.actorID,
                    email: "member@brown.edu"
                )
            )
        )

        let pagination = Task { @MainActor in
            await model.loadNextFeedPage()
        }
        await gate.waitUntilSuspended()
        await model.createPost(title: nil, body: "New post")
        await gate.release()
        await pagination.value

        guard case .loaded(let loaded) = model.state else {
            return XCTFail("Expected the post-mutation reload to win.")
        }
        XCTAssertTrue(loaded.feed.posts.isEmpty)
        let snapshot = await cache.snapshot()
        XCTAssertEqual(snapshot.feed, loaded.feed)
        XCTAssertEqual(snapshot.status, loaded.status)
    }

    private func assertAccessible(
        _ value: BoardStatePresentation,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertFalse(value.title.isEmpty, file: file, line: line)
        XCTAssertFalse(value.message.isEmpty, file: file, line: line)
        XCTAssertFalse(value.systemImage.isEmpty, file: file, line: line)
        XCTAssertFalse(
            value.accessibilityLabel.isEmpty,
            file: file,
            line: line
        )
    }
}

@MainActor
private final class Phase5BoardGoogleCallbackFake:
    GoogleCallbackHandling
{
    func handle(_ url: URL) -> Bool {
        false
    }
}

@MainActor
private final class Phase5BoardSupabaseCallbackFake:
    SupabaseCallbackHandling
{
    func establishSession(from url: URL) async throws {}
}
