import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class BoardModerationOwnerREDTests: XCTestCase {
    func testModeratorQueueDecisionsBansAndAppealsUseExactOperations()
        async throws
    {
        let transport = Phase5BoardTransport()
        await transport.enqueue(
            operationID: "getBoardModerationQueue",
            status: 200,
            json:
                """
                {
                  "items":[{
                    "queueKind":"report",
                    "queueId":"\(Phase5BoardFixture.requestID.uuidString.lowercased())",
                    "targetType":"post",
                    "targetId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                    "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                    "parentCommentId":null,
                    "title":"Question",
                    "body":"Reported body",
                    "visibility":"auto_hidden",
                    "moderationEpoch":2,
                    "score":-3,
                    "openReportCount":3,
                    "reportReasons":["spam"],
                    "appealBody":null,
                    "createdAt":"2026-07-30T18:00:00.000Z",
                    "updatedAt":"2026-07-30T18:01:00.000Z"
                  }],
                  "nextCursor":null
                }
                """
        )
        await transport.enqueue(
            operationID: "decideBoardPost",
            status: 200,
            json:
                """
                {
                  "targetType":"post",
                  "targetId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                  "visibility":"moderator_hidden",
                  "moderationEpoch":3,
                  "revision":4,
                  "replayed":false
                }
                """
        )
        await transport.enqueue(
            operationID: "createBoardCommentBan",
            status: 200,
            json:
                """
                {
                  "banId":"\(Phase5BoardFixture.banID.uuidString.lowercased())",
                  "expiresAt":"2026-07-30T19:00:00.000Z",
                  "replayed":false
                }
                """
        )
        await transport.enqueue(
            operationID: "revokeBoardBan",
            status: 200,
            json:
                """
                {
                  "banId":"\(Phase5BoardFixture.banID.uuidString.lowercased())",
                  "revokedAt":"2026-07-30T18:30:00.000Z",
                  "changed":true,
                  "replayed":false
                }
                """
        )
        await transport.enqueue(
            operationID: "decideBoardAppeal",
            status: 200,
            json:
                """
                {
                  "appealId":"\(Phase5BoardFixture.appealID.uuidString.lowercased())",
                  "state":"approved",
                  "targetType":"post",
                  "targetId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                  "changed":true,
                  "replayed":false
                }
                """
        )
        let repository = makeRepository(transport: transport)

        let queue = try await repository.moderationQueue(
            page: try BoardPageRequest(limit: 25)
        )
        let decision = try await repository.decideContent(
            BoardModerationDecisionCommand(
                clientRequestID: Phase5BoardFixture.requestID,
                target: .post(Phase5BoardFixture.postID),
                expectedEpoch: 2,
                action: .hide,
                reason: "Safety"
            )
        )
        let ban = try await repository.createBan(
            BoardCreateBanCommand(
                clientRequestID: Phase5BoardFixture.requestID,
                target: .comment(Phase5BoardFixture.commentID),
                durationSeconds: 3_600,
                reason: "Repeated abuse",
                note: "Owner-only operational note"
            )
        )
        let revoke = try await repository.revokeBan(
            BoardRevokeBanCommand(
                clientRequestID: Phase5BoardFixture.requestID,
                banID: Phase5BoardFixture.banID,
                reason: "Appeal accepted"
            )
        )
        let appeal = try await repository.decideAppeal(
            BoardAppealDecisionCommand(
                clientRequestID: Phase5BoardFixture.requestID,
                appealID: Phase5BoardFixture.appealID,
                decision: .approved,
                reason: "Restored after review"
            )
        )

        XCTAssertEqual(queue.items.count, 1)
        XCTAssertNil(queue.next)
        XCTAssertEqual(decision.moderationEpoch, 3)
        XCTAssertEqual(ban.id, Phase5BoardFixture.banID)
        XCTAssertTrue(revoke.changed)
        XCTAssertEqual(appeal.state, .approved)

        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            [
                "getBoardModerationQueue",
                "decideBoardPost",
                "createBoardCommentBan",
                "revokeBoardBan",
                "decideBoardAppeal",
            ]
        )
        let bodies = try records.dropFirst().map {
            try phase5BoardJSONObject($0.body)
        }
        XCTAssertEqual(
            bodies[0]["clientRequestId"] as? String,
            Phase5BoardFixture.requestID.uuidString.lowercased()
        )
        XCTAssertEqual(bodies[0]["expectedEpoch"] as? Int, 2)
        XCTAssertEqual(bodies[0]["action"] as? String, "hide")
        XCTAssertEqual(bodies[1]["durationSeconds"] as? Int, 3_600)
        XCTAssertEqual(
            bodies[2]["clientRequestId"] as? String,
            Phase5BoardFixture.requestID.uuidString.lowercased()
        )
        XCTAssertEqual(bodies[3]["decision"] as? String, "approved")
    }

    func testOwnerConfigAndModeratorMembershipUseOwnerOperationsOnly()
        async throws
    {
        let transport = Phase5BoardTransport()
        await transport.enqueue(
            operationID: "getBoardConfig",
            status: 200,
            json:
                """
                {
                  "enabled":true,
                  "autoHideThreshold":3,
                  "updatedAt":"2026-07-30T18:00:00.000Z"
                }
                """
        )
        await transport.enqueue(
            operationID: "updateBoardConfig",
            status: 200,
            json:
                """
                {
                  "enabled":false,
                  "autoHideThreshold":4,
                  "updatedAt":"2026-07-30T18:01:00.000Z",
                  "changed":true
                }
                """
        )
        await transport.enqueue(
            operationID: "listBoardModerators",
            status: 200,
            json:
                """
                {
                  "moderators":[{
                    "userId":"\(Phase5BoardFixture.moderatorID.uuidString.lowercased())",
                    "role":"moderator",
                    "grantedBy":"\(Phase5BoardFixture.actorID.uuidString.lowercased())",
                    "grantedAt":"2026-07-30T18:00:00.000Z"
                  }],
                  "nextCursor":null
                }
                """
        )
        await transport.enqueue(
            operationID: "addBoardModerator",
            status: 200,
            json:
                """
                {
                  "userId":"\(Phase5BoardFixture.moderatorID.uuidString.lowercased())",
                  "role":"moderator",
                  "changed":true
                }
                """
        )
        await transport.enqueue(
            operationID: "removeBoardModerator",
            status: 200,
            json:
                """
                {
                  "userId":"\(Phase5BoardFixture.moderatorID.uuidString.lowercased())",
                  "changed":true
                }
                """
        )
        let repository = makeRepository(transport: transport)

        _ = try await repository.config()
        _ = try await repository.updateConfig(
            BoardConfigUpdateCommand(
                enabled: false,
                autoHideThreshold: 4
            )
        )
        let moderators = try await repository.moderators(
            page: try BoardPageRequest(limit: 50)
        )
        _ = try await repository.upsertModerator(
            BoardModeratorUpsertCommand(
                userID: Phase5BoardFixture.moderatorID,
                role: .moderator
            )
        )
        _ = try await repository.removeModerator(
            userID: Phase5BoardFixture.moderatorID
        )

        XCTAssertEqual(
            moderators.moderators.map(\.userID),
            [Phase5BoardFixture.moderatorID]
        )
        XCTAssertNil(moderators.next)
        let operationIDs = await transport.records().map(\.operationID)
        XCTAssertEqual(
            operationIDs,
            [
                "getBoardConfig",
                "updateBoardConfig",
                "listBoardModerators",
                "addBoardModerator",
                "removeBoardModerator",
            ]
        )
    }

    func testModerationAndOwnerViewModelsGateBeforeRepositoryAndFailClosed()
        async
    {
        let moderation = Phase5BoardModerationRepositoryFake()
        let owner = Phase5BoardOwnerRepositoryFake()
        let cache = BoardMemoryCache()
        let moderationModel = BoardModerationViewModel(
            repository: moderation,
            cache: cache,
            requestIDs: Phase5BoardUUIDSource(
                [Phase5BoardFixture.requestID]
            )
        )
        let ownerModel = BoardOwnerViewModel(
            repository: owner,
            cache: cache
        )

        await moderationModel.load(authState: .signedOut)
        await ownerModel.load(authState: .authenticating)
        XCTAssertEqual(moderationModel.state, .authenticationRequired)
        XCTAssertEqual(ownerModel.state, .authenticationRequired)
        let moderationCalls = await moderation.recordedCalls()
        let ownerCalls = await owner.recordedCalls()
        XCTAssertTrue(moderationCalls.isEmpty)
        XCTAssertTrue(ownerCalls.isEmpty)

        await moderation.fail(with: .authorityRequired)
        await owner.fail(with: .authorityRequired)
        let admitted = AuthState.admitted(
            AdmittedIdentity(
                id: Phase5BoardFixture.actorID,
                email: "member@brown.edu"
            )
        )
        await moderationModel.load(authState: admitted)
        await ownerModel.load(authState: admitted)

        XCTAssertEqual(moderationModel.state, .authorityRequired)
        XCTAssertEqual(ownerModel.state, .authorityRequired)
        let snapshot = await cache.snapshot()
        XCTAssertNil(snapshot.moderationQueue)
        XCTAssertNil(snapshot.config)
        XCTAssertNil(snapshot.moderators)
    }

    func testModerationProjectionRejectsIdentityAndPrivateNoteAdditions()
        async
    {
        let transport = Phase5BoardTransport()
        await transport.enqueue(
            operationID: "getBoardModerationQueue",
            status: 200,
            json:
                """
                {
                  "items":[{
                    "queueKind":"report",
                    "queueId":"\(Phase5BoardFixture.requestID.uuidString.lowercased())",
                    "targetType":"post",
                    "targetId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                    "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                    "parentCommentId":null,
                    "title":"Question",
                    "body":"Reported body",
                    "visibility":"auto_hidden",
                    "moderationEpoch":2,
                    "score":-3,
                    "openReportCount":3,
                    "reportReasons":["spam"],
                    "appealBody":null,
                    "createdAt":"2026-07-30T18:00:00.000Z",
                    "updatedAt":"2026-07-30T18:01:00.000Z",
                    "authorToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "accountId":"\(Phase5BoardFixture.actorID.uuidString.lowercased())",
                    "email":"member@brown.edu",
                    "moderatorNote":"private"
                  }],
                  "nextCursor":null
                }
                """
        )
        let repository = makeRepository(transport: transport)

        do {
            _ = try await repository.moderationQueue(
                page: try BoardPageRequest()
            )
            XCTFail("Private moderation projection must fail closed.")
        } catch {
            XCTAssertEqual(error as? BoardError, .invalidResponse)
        }
    }

    func testModerationQueueRejectsCanonicalCrossFieldPrivacyViolations()
        async
    {
        let oversizedComment = String(repeating: "c", count: 2_001)
        let cases: [(String, String)] = [
            (
                "report appeal text",
                """
                "queueKind":"report",
                "targetType":"post",
                "targetId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                "parentCommentId":null,
                "title":"Question",
                "body":"Body",
                "visibility":"visible",
                "moderationEpoch":0,
                "score":0,
                "openReportCount":1,
                "reportReasons":["spam"],
                "appealBody":"Must not be present"
                """
            ),
            (
                "ban content projection",
                """
                "queueKind":"appeal",
                "targetType":"ban",
                "targetId":"\(Phase5BoardFixture.banID.uuidString.lowercased())",
                "postId":null,
                "parentCommentId":null,
                "title":null,
                "body":"Private content",
                "visibility":null,
                "moderationEpoch":null,
                "score":null,
                "openReportCount":0,
                "reportReasons":[],
                "appealBody":"Please review"
                """
            ),
            (
                "appeal missing text",
                """
                "queueKind":"appeal",
                "targetType":"post",
                "targetId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                "parentCommentId":null,
                "title":"Question",
                "body":"Body",
                "visibility":"visible",
                "moderationEpoch":0,
                "score":0,
                "openReportCount":0,
                "reportReasons":[],
                "appealBody":null
                """
            ),
            (
                "live nil body",
                """
                "queueKind":"report",
                "targetType":"post",
                "targetId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                "parentCommentId":null,
                "title":null,
                "body":null,
                "visibility":"visible",
                "moderationEpoch":0,
                "score":0,
                "openReportCount":1,
                "reportReasons":["spam"],
                "appealBody":null
                """
            ),
            (
                "comment title and body bound",
                """
                "queueKind":"report",
                "targetType":"comment",
                "targetId":"\(Phase5BoardFixture.commentID.uuidString.lowercased())",
                "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                "parentCommentId":null,
                "title":"Comments have no title",
                "body":"\(oversizedComment)",
                "visibility":"visible",
                "moderationEpoch":0,
                "score":0,
                "openReportCount":1,
                "reportReasons":["spam"],
                "appealBody":null
                """
            ),
            (
                "terminal text",
                """
                "queueKind":"report",
                "targetType":"post",
                "targetId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                "parentCommentId":null,
                "title":"Deleted title",
                "body":"Deleted body",
                "visibility":"removed",
                "moderationEpoch":1,
                "score":0,
                "openReportCount":1,
                "reportReasons":["spam"],
                "appealBody":null
                """
            ),
            (
                "too many report reasons",
                """
                "queueKind":"report",
                "targetType":"post",
                "targetId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                "parentCommentId":null,
                "title":null,
                "body":"Body",
                "visibility":"visible",
                "moderationEpoch":0,
                "score":0,
                "openReportCount":8,
                "reportReasons":["harassment","hate","threat","sexual","personal_info","spam","other","spam"],
                "appealBody":null
                """
            ),
        ]

        for (label, fields) in cases {
            let transport = Phase5BoardTransport()
            await transport.enqueue(
                operationID: "getBoardModerationQueue",
                status: 200,
                json:
                    """
                    {
                      "items":[{
                        "queueId":"\(Phase5BoardFixture.requestID.uuidString.lowercased())",
                        \(fields),
                        "createdAt":"2026-07-30T18:00:00.000Z",
                        "updatedAt":"2026-07-30T18:01:00.000Z"
                      }],
                      "nextCursor":null
                    }
                    """
            )
            let repository = makeRepository(transport: transport)

            do {
                _ = try await repository.moderationQueue(
                    page: BoardPageRequest()
                )
                XCTFail("Expected invalid response for \(label).")
            } catch {
                XCTAssertEqual(
                    error as? BoardError,
                    .invalidResponse,
                    label
                )
            }
        }
    }

    func testModeratorCommandsEnforceCanonicalBoundsBeforeTransport()
        async
    {
        let transport = Phase5BoardTransport()
        let repository = makeRepository(transport: transport)
        let reason = String(repeating: "r", count: 241)
        let note = String(repeating: "n", count: 1_001)
        let commands: [(String, () async throws -> Void)] = [
            (
                "moderation reason",
                {
                    _ = try await repository.decideContent(
                        BoardModerationDecisionCommand(
                            clientRequestID: Phase5BoardFixture.requestID,
                            target: .post(Phase5BoardFixture.postID),
                            expectedEpoch: 0,
                            action: .hide,
                            reason: reason
                        )
                    )
                }
            ),
            (
                "minimum ban duration",
                {
                    _ = try await repository.createBan(
                        BoardCreateBanCommand(
                            clientRequestID: Phase5BoardFixture.requestID,
                            target: .post(Phase5BoardFixture.postID),
                            durationSeconds: 299,
                            reason: "Safety",
                            note: nil
                        )
                    )
                }
            ),
            (
                "maximum ban duration",
                {
                    _ = try await repository.createBan(
                        BoardCreateBanCommand(
                            clientRequestID: Phase5BoardFixture.requestID,
                            target: .post(Phase5BoardFixture.postID),
                            durationSeconds: 31_536_001,
                            reason: "Safety",
                            note: nil
                        )
                    )
                }
            ),
            (
                "moderator note",
                {
                    _ = try await repository.createBan(
                        BoardCreateBanCommand(
                            clientRequestID: Phase5BoardFixture.requestID,
                            target: .post(Phase5BoardFixture.postID),
                            durationSeconds: 300,
                            reason: "Safety",
                            note: note
                        )
                    )
                }
            ),
            (
                "revoke reason",
                {
                    _ = try await repository.revokeBan(
                        BoardRevokeBanCommand(
                            clientRequestID: Phase5BoardFixture.requestID,
                            banID: Phase5BoardFixture.banID,
                            reason: "\n"
                        )
                    )
                }
            ),
            (
                "appeal decision reason",
                {
                    _ = try await repository.decideAppeal(
                        BoardAppealDecisionCommand(
                            clientRequestID: Phase5BoardFixture.requestID,
                            appealID: Phase5BoardFixture.appealID,
                            decision: .denied,
                            reason: reason
                        )
                    )
                }
            ),
        ]

        for (label, command) in commands {
            do {
                try await command()
                XCTFail("Expected invalid request for \(label).")
            } catch {
                XCTAssertEqual(
                    error as? BoardError,
                    .invalidRequest,
                    label
                )
            }
        }
        let records = await transport.records()
        XCTAssertTrue(records.isEmpty)
    }

    private func makeRepository(
        transport: Phase5BoardTransport
    ) -> WorkerBoardRepository {
        WorkerBoardRepository(
            client: BrownSyncAPI.Client(
                serverURL: URL(string: "https://api.example.invalid")!,
                configuration: WorkerAPIClientDefaults.configuration,
                transport: transport
            ),
            cache: BoardMemoryCache(),
            logger: Phase5BoardLogRecorder()
        )
    }
}
