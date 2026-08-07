import BrownSyncAPI
import XCTest

final class BoardAPIGenerationTests: XCTestCase {
    func testRepresentativeMemberModeratorAndOwnerOperationsAreGenerated() {
        XCTAssertTrue(
            Operations.GetBoardStatus.self == Operations.GetBoardStatus.self
        )
        XCTAssertTrue(
            Operations.CreateBoardPost.self == Operations.CreateBoardPost.self
        )
        XCTAssertTrue(
            Operations.GetBoardModerationQueue.self
                == Operations.GetBoardModerationQueue.self
        )
        XCTAssertTrue(
            Operations.DecideBoardPost.self == Operations.DecideBoardPost.self
        )
        XCTAssertTrue(
            Operations.GetBoardConfig.self == Operations.GetBoardConfig.self
        )
        XCTAssertTrue(
            Operations.UpdateBoardConfig.self
                == Operations.UpdateBoardConfig.self
        )
    }

    func testBoardStatusBodyKeepsExactPrivacyDisclosureFields() {
        func requireStatusBody(_ body: Operations.GetBoardStatus.Output.Ok.Body) {
            switch body {
            case let .json(value):
                let _: Components.Schemas.BoardStatus = value
                let _: Components.Schemas.BoardStatus.PrivacyNoticePayload =
                    value.privacyNotice
                let _: Components.Schemas.BoardStatus.EdgeMetadataNoticePayload =
                    value.edgeMetadataNotice
            }
        }

        _ = requireStatusBody
        XCTAssertEqual(
            Components.Schemas.BoardStatus.PrivacyNoticePayload.allCases
                .map(\.rawValue),
            [
                "Posts are pseudonymous, not untraceable. BrownSync stores a stable anonymous identifier so it can enforce bans, rate limits, and abuse controls. The board database does not store your BrownSync account ID with your posts. Your posts can be linked to each other, and someone who obtained both BrownSync’s private board secret and a list of Brown account IDs could reconstruct that link. Board moderators do not see your name or email through the moderation tools."
            ]
        )
        XCTAssertEqual(
            Components.Schemas.BoardStatus.EdgeMetadataNoticePayload.allCases
                .map(\.rawValue),
            [
                "Cloudflare processes normal edge request metadata, including IP addresses, to deliver and protect the service."
            ]
        )
    }

    func testGeneratedV2PostEditIsWiredToEditBoardPostInput() {
        let v2Request = Components.Schemas.BoardEditPostV2Request(
            version: 2,
            expectedRevision: 7,
            patch: Components.Schemas.BoardEditPostV2Patch(
                title: Components.Schemas.BoardEditPostTitleCommand(
                    action: .clear
                ),
                body: Components.Schemas.BoardEditPostBodyCommand(
                    action: .set,
                    value: "Updated body"
                )
            )
        )
        let input = Operations.EditBoardPost.Input(
            path: .init(
                postId: "60000000-0000-4000-8000-000000000001"
            ),
            body: .json(
                Components.Schemas.BoardEditPostRequest(value2: v2Request)
            )
        )

        XCTAssertEqual(
            Operations.EditBoardPost.id,
            "editBoardPost"
        )
        XCTAssertEqual(
            input.path.postId,
            "60000000-0000-4000-8000-000000000001"
        )
        switch input.body {
        case let .json(request):
            XCTAssertNil(request.value1)
            XCTAssertEqual(request.value2, v2Request)
        }
    }
}
