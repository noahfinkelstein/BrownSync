import BrownSyncAPI
import XCTest

final class OrganizationAPIGenerationTests: XCTestCase {
    func testNamedOrganizationSchemasAreGenerated() {
        XCTAssertTrue(Components.Schemas.OrgLink.self == Components.Schemas.OrgLink.self)
        XCTAssertTrue(
            Components.Schemas.OrgEnrichedDetail.self
                == Components.Schemas.OrgEnrichedDetail.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgMembership.self == Components.Schemas.OrgMembership.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgClaimSummary.self == Components.Schemas.OrgClaimSummary.self
        )
        XCTAssertTrue(
            Components.Schemas.MyOrganizations.self == Components.Schemas.MyOrganizations.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgCreateRequest.self == Components.Schemas.OrgCreateRequest.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgCreateResult.self == Components.Schemas.OrgCreateResult.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgClaimRequest.self == Components.Schemas.OrgClaimRequest.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgClaimResult.self == Components.Schemas.OrgClaimResult.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgReviewableClaim.self
                == Components.Schemas.OrgReviewableClaim.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgClaimReviewQueue.self
                == Components.Schemas.OrgClaimReviewQueue.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgClaimDecisionRequest.self
                == Components.Schemas.OrgClaimDecisionRequest.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgClaimDecisionResult.self
                == Components.Schemas.OrgClaimDecisionResult.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgEditPatch.self == Components.Schemas.OrgEditPatch.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgEditRequest.self == Components.Schemas.OrgEditRequest.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgEditResult.self == Components.Schemas.OrgEditResult.self
        )
    }

    func testOrganizationOperationsAreGenerated() {
        func requireLegacyDetailBody(_ body: Operations.GetApiOrgsId.Output.Ok.Body) {
            switch body {
            case let .json(value):
                let _: Components.Schemas.OrgDetail = value
            }
        }

        func requireEnrichedProfileBody(_ body: Operations.GetOrganizationProfile.Output.Ok.Body) {
            switch body {
            case let .json(value):
                let _: Components.Schemas.OrgEnrichedDetail = value
            }
        }

        _ = requireLegacyDetailBody
        _ = requireEnrichedProfileBody
        XCTAssertTrue(
            Operations.ListMyOrganizations.self == Operations.ListMyOrganizations.self
        )
        XCTAssertTrue(
            Operations.CreateOrganization.self == Operations.CreateOrganization.self
        )
        XCTAssertTrue(
            Operations.ClaimOrganization.self == Operations.ClaimOrganization.self
        )
        XCTAssertTrue(
            Operations.UpdateOrganization.self == Operations.UpdateOrganization.self
        )
        XCTAssertTrue(
            Operations.ListReviewableOrganizationClaims.self
                == Operations.ListReviewableOrganizationClaims.self
        )
        XCTAssertTrue(
            Operations.DecideOrganizationClaim.self
                == Operations.DecideOrganizationClaim.self
        )
        XCTAssertTrue(
            Operations.GetOrganizationProfile.self
                == Operations.GetOrganizationProfile.self
        )
    }

    func testGeneratedV2EditIsWiredToUpdateOrganizationInput() {
        let v2Request = Components.Schemas.OrgEditV2Request(
            version: 2,
            expectedRevision: 3,
            patch: Components.Schemas.OrgEditV2Patch(
                description: Components.Schemas.OrgEditDescriptionCommand(
                    action: .set,
                    value: "Updated description"
                ),
                aboutMd: Components.Schemas.OrgEditAboutMdCommand(
                    action: .clear
                ),
                meetingInfo: Components.Schemas.OrgEditMeetingInfoCommand(
                    action: .clear
                ),
                links: Components.Schemas.OrgEditLinksCommand(
                    action: .set,
                    value: [
                        Components.Schemas.OrgLink(
                            platform: .website,
                            url: "https://studentradio.example"
                        ),
                    ]
                )
            )
        )
        let input = Operations.UpdateOrganization.Input(
            path: .init(id: "brown-student-radio"),
            body: .json(
                Components.Schemas.OrgEditRequest(value2: v2Request)
            )
        )

        XCTAssertEqual(
            Operations.UpdateOrganization.id,
            "updateOrganization"
        )
        XCTAssertEqual(input.path.id, "brown-student-radio")
        switch input.body {
        case let .json(request):
            XCTAssertNil(request.value1)
            XCTAssertEqual(request.value2, v2Request)
        }
    }
}
