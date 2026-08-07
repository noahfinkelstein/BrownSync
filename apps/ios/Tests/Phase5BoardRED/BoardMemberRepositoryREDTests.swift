import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

final class BoardMemberRepositoryREDTests: XCTestCase {
    func testStatusFeedThreadAndOwnUseOnlyGeneratedReadOperations()
        async throws
    {
        let transport = Phase5BoardTransport()
        await transport.enqueue(
            operationID: "getBoardStatus",
            status: 200,
            json: Phase5BoardFixture.statusJSON
        )
        await transport.enqueue(
            operationID: "getBoardFeed",
            status: 200,
            json: Phase5BoardFixture.feedJSON
        )
        await transport.enqueue(
            operationID: "getBoardThread",
            status: 200,
            json: Phase5BoardFixture.threadJSON
        )
        await transport.enqueue(
            operationID: "getOwnBoardContent",
            status: 200,
            json: Phase5BoardFixture.ownJSON
        )
        let repository = makeRepository(transport: transport)
        let page = try BoardPageRequest(limit: 25)

        let status = try await repository.status()
        let feed = try await repository.feed(page: page)
        let thread = try await repository.thread(
            postID: Phase5BoardFixture.postID,
            page: page
        )
        let own = try await repository.ownContent(page: page)

        XCTAssertEqual(status.privacyNotice, Phase5BoardFixture.privacyNotice)
        XCTAssertEqual(
            status.edgeMetadataNotice,
            Phase5BoardFixture.edgeNotice
        )
        XCTAssertEqual(feed.posts.map(\.id), [Phase5BoardFixture.postID])
        XCTAssertNil(feed.next)
        XCTAssertEqual(thread.post.id, Phase5BoardFixture.postID)
        XCTAssertNil(thread.next)
        XCTAssertEqual(own.items.map(\.id), [Phase5BoardFixture.postID])
        XCTAssertNil(own.next)

        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            [
                "getBoardStatus",
                "getBoardFeed",
                "getBoardThread",
                "getOwnBoardContent",
            ]
        )
        XCTAssertEqual(
            records.map(\.method),
            ["GET", "GET", "GET", "GET"]
        )
        XCTAssertTrue(
            records[2].path.contains(
                Phase5BoardFixture.postID.uuidString.lowercased()
            )
        )
    }

    func testCursorAndPageValidationStayOpaqueStrictAndNullTerminated()
        throws
    {
        XCTAssertNil(BoardCursor(rawValue: ""))
        XCTAssertNil(BoardCursor(rawValue: "abc="))
        XCTAssertNil(BoardCursor(rawValue: String(repeating: "a", count: 257)))
        XCTAssertNotNil(BoardCursor(rawValue: Phase5BoardFixture.cursor))

        XCTAssertThrowsError(try BoardPageRequest(limit: 0)) { error in
            XCTAssertEqual(error as? BoardError, .invalidPage)
        }
        XCTAssertThrowsError(try BoardPageRequest(limit: 51)) { error in
            XCTAssertEqual(error as? BoardError, .invalidPage)
        }
        XCTAssertEqual(try BoardPageRequest().limit, 25)
    }

    func testPostAndCommentMutationsPreserveRequestIDsAndRevisions()
        async throws
    {
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
        await transport.enqueue(
            operationID: "editBoardPost",
            status: 200,
            json:
                """
                {
                  "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                  "revision":2,
                  "changed":true
                }
                """
        )
        await transport.enqueue(
            operationID: "deleteBoardPost",
            status: 200,
            json:
                """
                {
                  "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                  "revision":3,
                  "changed":true
                }
                """
        )
        await transport.enqueue(
            operationID: "createBoardComment",
            status: 201,
            json:
                """
                {
                  "commentId":"\(Phase5BoardFixture.commentID.uuidString.lowercased())",
                  "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                  "revision":1,
                  "replayed":false
                }
                """
        )
        await transport.enqueue(
            operationID: "editBoardComment",
            status: 200,
            json:
                """
                {
                  "commentId":"\(Phase5BoardFixture.commentID.uuidString.lowercased())",
                  "revision":2,
                  "changed":true
                }
                """
        )
        await transport.enqueue(
            operationID: "deleteBoardComment",
            status: 200,
            json:
                """
                {
                  "commentId":"\(Phase5BoardFixture.commentID.uuidString.lowercased())",
                  "revision":3,
                  "changed":true
                }
                """
        )
        let repository = makeRepository(transport: transport)

        let createdPost = try await repository.createPost(
            BoardCreatePostCommand(
                clientRequestID: Phase5BoardFixture.requestID,
                title: "Question",
                body: "What should BrownSync build?"
            )
        )
        let editedPost = try await repository.editPost(
            id: Phase5BoardFixture.postID,
            command: try BoardEditPostCommand(
                expectedRevision: 1,
                title: .unchanged,
                body: .set("Updated body")
            )
        )
        let deletedPost = try await repository.deletePost(
            id: Phase5BoardFixture.postID,
            expectedRevision: 2
        )
        let createdComment = try await repository.createComment(
            BoardCreateCommentCommand(
                clientRequestID: Phase5BoardFixture.requestID,
                postID: Phase5BoardFixture.postID,
                parentCommentID: nil,
                body: "A reply"
            )
        )
        let editedComment = try await repository.editComment(
            id: Phase5BoardFixture.commentID,
            expectedRevision: 1,
            body: "Updated reply"
        )
        let deletedComment = try await repository.deleteComment(
            id: Phase5BoardFixture.commentID,
            expectedRevision: 2
        )

        XCTAssertEqual(createdPost.revision, 1)
        XCTAssertEqual(editedPost.revision, 2)
        XCTAssertEqual(deletedPost.revision, 3)
        XCTAssertEqual(createdComment.revision, 1)
        XCTAssertEqual(editedComment.revision, 2)
        XCTAssertEqual(deletedComment.revision, 3)

        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            [
                "createBoardPost",
                "editBoardPost",
                "deleteBoardPost",
                "createBoardComment",
                "editBoardComment",
                "deleteBoardComment",
            ]
        )
        let bodies = try records.map { try phase5BoardJSONObject($0.body) }
        XCTAssertEqual(
            bodies[0]["clientRequestId"] as? String,
            Phase5BoardFixture.requestID.uuidString.lowercased()
        )
        XCTAssertEqual(
            bodies[1] as NSDictionary,
            [
                "version": 2,
                "expectedRevision": 1,
                "patch": [
                    "body": [
                        "action": "set",
                        "value": "Updated body",
                    ]
                ],
            ] as NSDictionary
        )
        XCTAssertEqual(bodies[2]["expectedRevision"] as? Int, 2)
        XCTAssertEqual(
            bodies[3]["clientRequestId"] as? String,
            Phase5BoardFixture.requestID.uuidString.lowercased()
        )
        XCTAssertEqual(bodies[4]["expectedRevision"] as? Int, 1)
        XCTAssertEqual(bodies[5]["expectedRevision"] as? Int, 2)
    }

    func testPostTitleClearUsesVersion2CommandAndOmitsBody()
        async throws
    {
        let transport = Phase5BoardTransport()
        await transport.enqueue(
            operationID: "editBoardPost",
            status: 200,
            json:
                """
                {
                  "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                  "revision":3,
                  "changed":true
                }
                """
        )
        let repository = makeRepository(transport: transport)

        let result = try await repository.editPost(
            id: Phase5BoardFixture.postID,
            command: try BoardEditPostCommand(
                expectedRevision: 2,
                title: .clear,
                body: .unchanged
            )
        )

        XCTAssertEqual(result.revision, 3)
        let records = await transport.records()
        XCTAssertEqual(records.map(\.operationID), ["editBoardPost"])
        XCTAssertEqual(
            try phase5BoardJSONObject(records[0].body)
                as NSDictionary,
            [
                "version": 2,
                "expectedRevision": 2,
                "patch": [
                    "title": [
                        "action": "clear"
                    ]
                ],
            ] as NSDictionary
        )
    }

    func testPostBodyClearIsRejectedBeforeTransport() async {
        let transport = Phase5BoardTransport()
        let repository = makeRepository(transport: transport)

        do {
            let command = try BoardEditPostCommand(
                expectedRevision: 2,
                title: .unchanged,
                body: .clear
            )
            _ = try await repository.editPost(
                id: Phase5BoardFixture.postID,
                command: command
            )
            XCTFail("Expected body clear to be rejected")
        } catch {
            XCTAssertEqual(error as? BoardError, .invalidRequest)
        }

        let records = await transport.records()
        XCTAssertTrue(records.isEmpty)
    }

    func testVoteReportAndAppealsUseExactTargetOperationsAndBodies()
        async throws
    {
        let transport = Phase5BoardTransport()
        await transport.enqueue(
            operationID: "setBoardPostVote",
            status: 200,
            json:
                """
                {
                  "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                  "commentId":null,
                  "value":1,
                  "score":5,
                  "changed":true
                }
                """
        )
        await transport.enqueue(
            operationID: "reportBoardComment",
            status: 200,
            json:
                """
                {
                  "reportId":"\(Phase5BoardFixture.requestID.uuidString.lowercased())",
                  "targetEpoch":2,
                  "visibility":"visible",
                  "revision":3,
                  "autoHidden":false,
                  "replayed":false
                }
                """
        )
        let appealJSON =
            """
            {
              "appealId":"\(Phase5BoardFixture.appealID.uuidString.lowercased())",
              "state":"pending",
              "replayed":false
            }
            """
        await transport.enqueue(
            operationID: "appealBoardPost",
            status: 200,
            json: appealJSON
        )
        await transport.enqueue(
            operationID: "appealBoardBan",
            status: 200,
            json: appealJSON
        )
        let repository = makeRepository(transport: transport)

        let vote = try await repository.setVote(
            target: .post(Phase5BoardFixture.postID),
            value: .up
        )
        let report = try await repository.report(
            target: .comment(Phase5BoardFixture.commentID),
            reason: .personalInfo,
            detail: "Contains identifying details"
        )
        let contentAppeal = try await repository.appealContent(
            BoardContentAppealCommand(
                clientRequestID: Phase5BoardFixture.requestID,
                target: .post(Phase5BoardFixture.postID),
                targetEpoch: 2,
                body: "Please review this decision."
            )
        )
        let banAppeal = try await repository.appealBan(
            BoardBanAppealCommand(
                clientRequestID: Phase5BoardFixture.requestID,
                banID: Phase5BoardFixture.banID,
                body: "Please review this ban."
            )
        )

        XCTAssertEqual(vote.value, .up)
        XCTAssertEqual(report.targetEpoch, 2)
        XCTAssertEqual(contentAppeal.state, .pending)
        XCTAssertEqual(banAppeal.state, .pending)

        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            [
                "setBoardPostVote",
                "reportBoardComment",
                "appealBoardPost",
                "appealBoardBan",
            ]
        )
        let bodies = try records.map { try phase5BoardJSONObject($0.body) }
        XCTAssertEqual(bodies[0]["value"] as? Int, 1)
        XCTAssertEqual(bodies[1]["reason"] as? String, "personal_info")
        XCTAssertEqual(
            bodies[2]["clientRequestId"] as? String,
            Phase5BoardFixture.requestID.uuidString.lowercased()
        )
        XCTAssertEqual(bodies[2]["targetEpoch"] as? Int, 2)
        XCTAssertEqual(
            bodies[3]["clientRequestId"] as? String,
            Phase5BoardFixture.requestID.uuidString.lowercased()
        )
    }

    func testStableErrorsMapWithoutRetryingAMutation() async {
        let cases: [(Int, String, BoardError)] = [
            (403, "board_banned", .banned),
            (409, "conflict", .conflict),
            (429, "rate_limited", .quotaLimited),
            (503, "board_service_unavailable", .unavailable),
        ]

        for (status, code, expected) in cases {
            let transport = Phase5BoardTransport()
            await transport.enqueue(
                operationID: "editBoardComment",
                status: status,
                json:
                    """
                    {"error":{"code":"\(code)","message":"safe"}}
                    """
            )
            let repository = makeRepository(transport: transport)

            do {
                _ = try await repository.editComment(
                    id: Phase5BoardFixture.commentID,
                    expectedRevision: 2,
                    body: "Updated"
                )
                XCTFail("Expected \(expected)")
            } catch {
                XCTAssertEqual(error as? BoardError, expected)
            }

            let records = await transport.records()
            XCTAssertEqual(records.map(\.operationID), ["editBoardComment"])
        }
    }

    func testPrivateResponseAdditionsFailClosedAndNeverEnterDomainState()
        async
    {
        let transport = Phase5BoardTransport()
        let privateProjection = Phase5BoardFixture.statusJSON
            .replacingOccurrences(
                of: "\n}",
                with:
                    """
                    ,
                      "authorToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                      "accountId":"\(Phase5BoardFixture.actorID.uuidString.lowercased())",
                      "email":"member@brown.edu",
                      "moderatorNote":"private"
                    }
                    """
            )
        await transport.enqueue(
            operationID: "getBoardStatus",
            status: 200,
            json: privateProjection
        )
        let logger = Phase5BoardLogRecorder()
        let repository = makeRepository(
            transport: transport,
            logger: logger
        )

        do {
            _ = try await repository.status()
            XCTFail("Private additions must not map.")
        } catch {
            XCTAssertEqual(error as? BoardError, .invalidResponse)
        }

        let events = await logger.events()
        XCTAssertEqual(events.last?.outcome, .failed(.invalidResponse))
        XCTAssertFalse(String(reflecting: events).contains("member@brown.edu"))
        XCTAssertFalse(String(reflecting: events).contains("aaaaaaaa"))
    }

    func testOwnContentRejectsCanonicalCrossFieldPrivacyViolations() async {
        let oversizedComment = String(repeating: "a", count: 2_001)
        let cases:
            [(
                label: String,
                type: String,
                id: UUID,
                title: String,
                body: String,
                visibility: String
            )] = [
                (
                    "comment title",
                    "comment",
                    Phase5BoardFixture.commentID,
                    "\"Unexpected\"",
                    "\"Comment\"",
                    "visible"
                ),
                (
                    "terminal text",
                    "post",
                    Phase5BoardFixture.postID,
                    "\"Deleted title\"",
                    "\"Deleted body\"",
                    "author_deleted"
                ),
                (
                    "live nil body",
                    "post",
                    Phase5BoardFixture.postID,
                    "null",
                    "null",
                    "visible"
                ),
                (
                    "oversized comment",
                    "comment",
                    Phase5BoardFixture.commentID,
                    "null",
                    "\"\(oversizedComment)\"",
                    "visible"
                ),
            ]

        for value in cases {
            let transport = Phase5BoardTransport()
            await transport.enqueue(
                operationID: "getOwnBoardContent",
                status: 200,
                json:
                    """
                    {
                      "items":[{
                        "contentType":"\(value.type)",
                        "id":"\(value.id.uuidString.lowercased())",
                        "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
                        "parentCommentId":null,
                        "title":\(value.title),
                        "body":\(value.body),
                        "visibility":"\(value.visibility)",
                        "moderationEpoch":0,
                        "score":0,
                        "revision":1,
                        "authorAlias":"Anonymous Otter 4F2A",
                        "isMine":true,
                        "createdAt":"2026-07-30T18:00:00.000Z",
                        "updatedAt":"2026-07-30T18:01:00.000Z"
                      }],
                      "nextCursor":null
                    }
                    """
            )
            let repository = makeRepository(transport: transport)

            do {
                _ = try await repository.ownContent(
                    page: BoardPageRequest()
                )
                XCTFail("Expected invalid response for \(value.label).")
            } catch {
                XCTAssertEqual(
                    error as? BoardError,
                    .invalidResponse,
                    value.label
                )
            }
        }
    }

    func testMemberCommandsEnforceCanonicalTrimmedBoundsBeforeTransport()
        async
    {
        let transport = Phase5BoardTransport()
        let repository = makeRepository(transport: transport)
        let comment = String(repeating: "c", count: 2_001)
        let detail = String(repeating: "d", count: 1_001)
        let appeal = String(repeating: "a", count: 2_001)
        let commands: [(String, () async throws -> Void)] = [
            (
                "post body",
                {
                    _ = try await repository.createPost(
                        BoardCreatePostCommand(
                            clientRequestID: Phase5BoardFixture.requestID,
                            title: nil,
                            body: "   "
                        )
                    )
                }
            ),
            (
                "comment body",
                {
                    _ = try await repository.createComment(
                        BoardCreateCommentCommand(
                            clientRequestID: Phase5BoardFixture.requestID,
                            postID: Phase5BoardFixture.postID,
                            parentCommentID: nil,
                            body: comment
                        )
                    )
                }
            ),
            (
                "edited comment body",
                {
                    _ = try await repository.editComment(
                        id: Phase5BoardFixture.commentID,
                        expectedRevision: 1,
                        body: comment
                    )
                }
            ),
            (
                "report detail",
                {
                    _ = try await repository.report(
                        target: .post(Phase5BoardFixture.postID),
                        reason: .other,
                        detail: detail
                    )
                }
            ),
            (
                "content appeal",
                {
                    _ = try await repository.appealContent(
                        BoardContentAppealCommand(
                            clientRequestID: Phase5BoardFixture.requestID,
                            target: .post(Phase5BoardFixture.postID),
                            targetEpoch: 0,
                            body: appeal
                        )
                    )
                }
            ),
            (
                "ban appeal",
                {
                    _ = try await repository.appealBan(
                        BoardBanAppealCommand(
                            clientRequestID: Phase5BoardFixture.requestID,
                            banID: Phase5BoardFixture.banID,
                            body: "\n\t"
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

    func testGeneratedCollectionsCannotBypassCanonicalPageMaximum()
        async
    {
        let post =
            """
            {
              "id":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
              "title":"Question",
              "body":"Body",
              "visibility":"visible",
              "moderationEpoch":0,
              "score":0,
              "revision":1,
              "authorAlias":"Anonymous Otter 4F2A",
              "isMine":true,
              "commentCount":0,
              "myVote":0,
              "createdAt":"2026-07-30T18:00:00.000Z",
              "updatedAt":"2026-07-30T18:01:00.000Z"
            }
            """
        let transport = Phase5BoardTransport()
        await transport.enqueue(
            operationID: "getBoardFeed",
            status: 200,
            json:
                """
                {
                  "posts":[\(Array(repeating: post, count: 51).joined(separator: ","))],
                  "nextCursor":null
                }
                """
        )
        let repository = makeRepository(transport: transport)

        do {
            _ = try await repository.feed(page: BoardPageRequest())
            XCTFail("Expected an oversized projection to fail closed.")
        } catch {
            XCTAssertEqual(error as? BoardError, .invalidResponse)
        }
    }

    func testThreadCommentProjectionEnforcesTheTwoThousandCharacterLimit()
        async
    {
        let oversizedComment = String(repeating: "c", count: 2_001)
        let comment =
            """
            {
              "id":"\(Phase5BoardFixture.commentID.uuidString.lowercased())",
              "postId":"\(Phase5BoardFixture.postID.uuidString.lowercased())",
              "parentCommentId":null,
              "body":"\(oversizedComment)",
              "visibility":"visible",
              "moderationEpoch":0,
              "score":0,
              "revision":1,
              "authorAlias":"Anonymous Otter 4F2A",
              "isMine":true,
              "myVote":0,
              "createdAt":"2026-07-30T18:00:00.000Z",
              "updatedAt":"2026-07-30T18:01:00.000Z"
            }
            """
        let response = Phase5BoardFixture.threadJSON.replacingOccurrences(
            of: "\"comments\":[]",
            with: "\"comments\":[\(comment)]"
        )
        let transport = Phase5BoardTransport()
        await transport.enqueue(
            operationID: "getBoardThread",
            status: 200,
            json: response
        )
        let repository = makeRepository(transport: transport)

        do {
            _ = try await repository.thread(
                postID: Phase5BoardFixture.postID,
                page: BoardPageRequest()
            )
            XCTFail("Expected an oversized comment to fail closed.")
        } catch {
            XCTAssertEqual(error as? BoardError, .invalidResponse)
        }
    }

    private func makeRepository(
        transport: Phase5BoardTransport,
        cache: BoardMemoryCache = BoardMemoryCache(),
        logger: Phase5BoardLogRecorder = Phase5BoardLogRecorder()
    ) -> WorkerBoardRepository {
        let client = BrownSyncAPI.Client(
            serverURL: URL(string: "https://api.example.invalid")!,
            configuration: WorkerAPIClientDefaults.configuration,
            transport: transport
        )
        return WorkerBoardRepository(
            client: client,
            cache: cache,
            logger: logger
        )
    }
}
