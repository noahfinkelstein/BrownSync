import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

final class BoardGeneratedOperationsREDTests: XCTestCase {
    func testEveryFrozenBoardOperationRemainsGenerated() {
        let operations: [Any.Type] = [
            Operations.GetBoardFeed.self,
            Operations.HeadBoardFeed.self,
            Operations.GetBoardThread.self,
            Operations.HeadBoardThread.self,
            Operations.GetOwnBoardContent.self,
            Operations.HeadOwnBoardContent.self,
            Operations.GetBoardStatus.self,
            Operations.HeadBoardStatus.self,
            Operations.CreateBoardPost.self,
            Operations.EditBoardPost.self,
            Operations.DeleteBoardPost.self,
            Operations.CreateBoardComment.self,
            Operations.EditBoardComment.self,
            Operations.DeleteBoardComment.self,
            Operations.SetBoardPostVote.self,
            Operations.SetBoardCommentVote.self,
            Operations.ReportBoardPost.self,
            Operations.ReportBoardComment.self,
            Operations.AppealBoardPost.self,
            Operations.AppealBoardComment.self,
            Operations.AppealBoardBan.self,
            Operations.GetBoardModerationQueue.self,
            Operations.HeadBoardModerationQueue.self,
            Operations.DecideBoardPost.self,
            Operations.DecideBoardComment.self,
            Operations.CreateBoardPostBan.self,
            Operations.CreateBoardCommentBan.self,
            Operations.RevokeBoardBan.self,
            Operations.DecideBoardAppeal.self,
            Operations.GetBoardConfig.self,
            Operations.HeadBoardConfig.self,
            Operations.UpdateBoardConfig.self,
            Operations.ListBoardModerators.self,
            Operations.HeadBoardModerators.self,
            Operations.AddBoardModerator.self,
            Operations.RemoveBoardModerator.self,
        ]

        XCTAssertEqual(operations.count, 36)
    }

    func testGeneratedStatusPinsBothHonestDisclosuresVerbatim() {
        XCTAssertEqual(
            Components.Schemas.BoardStatus.PrivacyNoticePayload.allCases
                .map(\.rawValue),
            [Phase5BoardFixture.privacyNotice]
        )
        XCTAssertEqual(
            Components.Schemas.BoardStatus.EdgeMetadataNoticePayload.allCases
                .map(\.rawValue),
            [Phase5BoardFixture.edgeNotice]
        )
    }

    func testRequestCursorIsNonnullableWhileEveryNextCursorIsNullable() {
        func requireFeedRequest(
            _ value: Components.Schemas.BoardCursor?
        ) {
            _ = Operations.GetBoardFeed.Input.Query(
                cursor: value,
                limit: 25
            )
        }

        func requireFeedResponse(
            _ value: Components.Schemas.BoardFeed
        ) {
            let _: Components.Schemas.BoardNullableCursor? =
                value.nextCursor
        }

        func requireThreadResponse(
            _ value: Components.Schemas.BoardThread
        ) {
            let _: Components.Schemas.BoardNullableCursor? =
                value.nextCursor
        }

        func requireOwnResponse(
            _ value: Components.Schemas.BoardOwnContent
        ) {
            let _: Components.Schemas.BoardNullableCursor? =
                value.nextCursor
        }

        func requireModerationResponse(
            _ value: Components.Schemas.BoardModerationQueue
        ) {
            let _: Components.Schemas.BoardNullableCursor? =
                value.nextCursor
        }

        func requireModeratorResponse(
            _ value: Components.Schemas.BoardModerators
        ) {
            let _: Components.Schemas.BoardNullableCursor? =
                value.nextCursor
        }

        _ = requireFeedRequest
        _ = requireFeedResponse
        _ = requireThreadResponse
        _ = requireOwnResponse
        _ = requireModerationResponse
        _ = requireModeratorResponse
    }

    func testGeneratedPostEditV2EncodesBodySetAndTitleClearExactly()
        throws
    {
        let bodyOnly = Components.Schemas.BoardEditPostV2Request(
            version: 2,
            expectedRevision: 7,
            patch: Components.Schemas.BoardEditPostV2Patch(
                body: Components.Schemas.BoardEditPostBodyCommand(
                    action: .set,
                    value: "Updated body"
                )
            )
        )
        let clearTitle = Components.Schemas.BoardEditPostV2Request(
            version: 2,
            expectedRevision: 8,
            patch: Components.Schemas.BoardEditPostV2Patch(
                title: Components.Schemas.BoardEditPostTitleCommand(
                    action: .clear
                )
            )
        )

        let bodyOnlyObject = try phase5BoardJSONObject(
            JSONEncoder().encode(bodyOnly)
        )
        let clearTitleObject = try phase5BoardJSONObject(
            JSONEncoder().encode(clearTitle)
        )

        XCTAssertEqual(
            bodyOnlyObject as NSDictionary,
            [
                "version": 2,
                "expectedRevision": 7,
                "patch": [
                    "body": [
                        "action": "set",
                        "value": "Updated body",
                    ]
                ],
            ] as NSDictionary
        )
        XCTAssertEqual(
            clearTitleObject as NSDictionary,
            [
                "version": 2,
                "expectedRevision": 8,
                "patch": [
                    "title": [
                        "action": "clear"
                    ]
                ],
            ] as NSDictionary
        )
    }

    func testNativeVoteWrapperAcceptsOnlyTheThreeContractValues() {
        XCTAssertEqual(BoardVoteValue.down.rawValue, -1)
        XCTAssertEqual(BoardVoteValue.none.rawValue, 0)
        XCTAssertEqual(BoardVoteValue.up.rawValue, 1)
        XCTAssertNil(BoardVoteValue(rawValue: 2))
    }
}
