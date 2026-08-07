import BrownSyncAPI
import Foundation
import XCTest

final class UserEventGeneratedV2OperationsREDTests: XCTestCase {
    func testGeneratedUserEventV2EncodesDescriptionSetEndClearAndOmissionExactly()
        throws
    {
        let request = Components.Schemas.UserEventEditV2Request(
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
                )
            )
        )

        let object = try phase5UserEventJSONObject(
            JSONEncoder().encode(request)
        )

        XCTAssertEqual(
            object as NSDictionary,
            [
                "version": 2,
                "expectedRevision": 2,
                "patch": [
                    "description": [
                        "action": "set",
                        "value": "Updated description",
                    ],
                    "end": [
                        "action": "clear"
                    ],
                ],
            ] as NSDictionary
        )
    }

    func testGeneratedUserEventV2EncodesURLSetWithOtherCommandsOmittedExactly()
        throws
    {
        let request = Components.Schemas.UserEventEditV2Request(
            version: 2,
            expectedRevision: 3,
            patch: Components.Schemas.UserEventEditV2Patch(
                url: Components.Schemas.UserEventEditUrlCommand(
                    action: .set,
                    value: "https://events.example/open-mic"
                )
            )
        )

        let object = try phase5UserEventJSONObject(
            JSONEncoder().encode(request)
        )

        XCTAssertEqual(
            object as NSDictionary,
            [
                "version": 2,
                "expectedRevision": 3,
                "patch": [
                    "url": [
                        "action": "set",
                        "value":
                            "https://events.example/open-mic",
                    ]
                ],
            ] as NSDictionary
        )
    }
}
