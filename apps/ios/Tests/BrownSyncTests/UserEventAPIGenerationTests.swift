import BrownSyncAPI
import XCTest

final class UserEventAPIGenerationTests: XCTestCase {
    func testNamedUserEventSchemasAreGenerated() {
        XCTAssertTrue(
            Components.Schemas.UserEventCreateRequest.self
                == Components.Schemas.UserEventCreateRequest.self
        )
        XCTAssertTrue(
            Components.Schemas.UserEventEditPatch.self
                == Components.Schemas.UserEventEditPatch.self
        )
        XCTAssertTrue(
            Components.Schemas.UserEventEditRequest.self
                == Components.Schemas.UserEventEditRequest.self
        )
        XCTAssertTrue(
            Components.Schemas.UserEventCreateResult.self
                == Components.Schemas.UserEventCreateResult.self
        )
        XCTAssertTrue(
            Components.Schemas.UserEventMutationResult.self
                == Components.Schemas.UserEventMutationResult.self
        )
        XCTAssertTrue(
            Components.Schemas.UserEventManagement.self
                == Components.Schemas.UserEventManagement.self
        )
        XCTAssertTrue(
            Components.Schemas.UserEventManagementCursor.self
                == Components.Schemas.UserEventManagementCursor.self
        )
        XCTAssertTrue(
            Components.Schemas.MyUserEvents.self == Components.Schemas.MyUserEvents.self
        )
    }

    func testUserEventOperationsAreGeneratedWithoutRenamingLegacyReads() {
        XCTAssertTrue(Operations.CreateUserEvent.self == Operations.CreateUserEvent.self)
        XCTAssertTrue(Operations.UpdateUserEvent.self == Operations.UpdateUserEvent.self)
        XCTAssertTrue(Operations.DeleteUserEvent.self == Operations.DeleteUserEvent.self)
        XCTAssertTrue(Operations.ListMyUserEvents.self == Operations.ListMyUserEvents.self)
        XCTAssertTrue(Operations.GetMyUserEvent.self == Operations.GetMyUserEvent.self)

        XCTAssertTrue(Operations.GetApiEvents.self == Operations.GetApiEvents.self)
        XCTAssertTrue(Operations.GetApiEventsId.self == Operations.GetApiEventsId.self)
    }

    func testGeneratedV2EditIsWiredToUpdateUserEventInput() {
        let v2Request = Components.Schemas.UserEventEditV2Request(
            version: 2,
            expectedRevision: 2,
            patch: Components.Schemas.UserEventEditV2Patch(
                description:
                    Components.Schemas.UserEventEditDescriptionCommand(
                        action: .set,
                        value: "Updated description"
                    ),
                end: Components.Schemas.UserEventEditEndCommand(
                    action: .clear
                ),
                url: Components.Schemas.UserEventEditUrlCommand(
                    action: .set,
                    value: "https://events.example/open-mic"
                )
            )
        )
        let input = Operations.UpdateUserEvent.Input(
            path: .init(
                id: "40000000-0000-4000-8000-000000000001"
            ),
            body: .json(
                Components.Schemas.UserEventEditRequest(value2: v2Request)
            )
        )

        XCTAssertEqual(
            Operations.UpdateUserEvent.id,
            "updateUserEvent"
        )
        XCTAssertEqual(
            input.path.id,
            "40000000-0000-4000-8000-000000000001"
        )
        switch input.body {
        case let .json(request):
            XCTAssertNil(request.value1)
            XCTAssertEqual(request.value2, v2Request)
        }
    }
}
