import BrownSyncAPI
import XCTest

final class OrgAssetAPIGenerationTests: XCTestCase {
    func testNamedOrganizationAssetSchemasAreGenerated() {
        XCTAssertTrue(
            Components.Schemas.OrgMediaKind.self == Components.Schemas.OrgMediaKind.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgMediaAsset.self == Components.Schemas.OrgMediaAsset.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgMediaCollection.self
                == Components.Schemas.OrgMediaCollection.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgMediaUploadReservationRequest.self
                == Components.Schemas.OrgMediaUploadReservationRequest.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgMediaUploadReservation.self
                == Components.Schemas.OrgMediaUploadReservation.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgMediaUploadResult.self
                == Components.Schemas.OrgMediaUploadResult.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgMediaMutationRequest.self
                == Components.Schemas.OrgMediaMutationRequest.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgMediaMutationResult.self
                == Components.Schemas.OrgMediaMutationResult.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgGalleryReorderRequest.self
                == Components.Schemas.OrgGalleryReorderRequest.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgGalleryReorderResult.self
                == Components.Schemas.OrgGalleryReorderResult.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgSocialRenderMode.self
                == Components.Schemas.OrgSocialRenderMode.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgSocialPost.self == Components.Schemas.OrgSocialPost.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgSocialPostCollection.self
                == Components.Schemas.OrgSocialPostCollection.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgSocialPostCreateRequest.self
                == Components.Schemas.OrgSocialPostCreateRequest.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgSocialPostCreateResult.self
                == Components.Schemas.OrgSocialPostCreateResult.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgSocialPostRefreshResult.self
                == Components.Schemas.OrgSocialPostRefreshResult.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgSocialPostDeleteRequest.self
                == Components.Schemas.OrgSocialPostDeleteRequest.self
        )
        XCTAssertTrue(
            Components.Schemas.OrgSocialPostDeleteResult.self
                == Components.Schemas.OrgSocialPostDeleteResult.self
        )
    }

    func testOrganizationAssetOperationsAndBinaryUploadBodyAreGenerated() {
        func requireBinaryUploadBody(_ body: Operations.UploadOrganizationMedia.Input.Body) {
            _ = body
        }

        _ = requireBinaryUploadBody
        XCTAssertTrue(
            Operations.GetOrganizationMedia.self == Operations.GetOrganizationMedia.self
        )
        XCTAssertTrue(
            Operations.ReserveOrganizationMediaUpload.self
                == Operations.ReserveOrganizationMediaUpload.self
        )
        XCTAssertTrue(
            Operations.UploadOrganizationMedia.self
                == Operations.UploadOrganizationMedia.self
        )
        XCTAssertTrue(
            Operations.DeleteOrganizationMedia.self
                == Operations.DeleteOrganizationMedia.self
        )
        XCTAssertTrue(
            Operations.ReorderOrganizationGallery.self
                == Operations.ReorderOrganizationGallery.self
        )
        XCTAssertTrue(
            Operations.ListOrganizationSocialPosts.self
                == Operations.ListOrganizationSocialPosts.self
        )
        XCTAssertTrue(
            Operations.AddOrganizationSocialPost.self
                == Operations.AddOrganizationSocialPost.self
        )
        XCTAssertTrue(
            Operations.RefreshOrganizationSocialPost.self
                == Operations.RefreshOrganizationSocialPost.self
        )
        XCTAssertTrue(
            Operations.DeleteOrganizationSocialPost.self
                == Operations.DeleteOrganizationSocialPost.self
        )
        XCTAssertTrue(
            Operations.GetOrganizationSocialEmbed.self
                == Operations.GetOrganizationSocialEmbed.self
        )
    }

    func testGeneratedReservationInputAndNullableCollectionSurface() {
        func requireNullableAssets(
            _ collection: Components.Schemas.OrgMediaCollection
        ) {
            let _: Components.Schemas.NullableOrgMediaAsset? =
                collection.avatar
            let _: Components.Schemas.NullableOrgMediaAsset? =
                collection.banner
        }

        _ = requireNullableAssets
        XCTAssertTrue(
            Components.Schemas.NullableOrgMediaAsset.self
                == Components.Schemas.NullableOrgMediaAsset.self
        )

        let request =
            Components.Schemas.OrgMediaUploadReservationRequest(
                clientRequestId:
                    "50000000-0000-4000-8000-000000000001",
                kind: .avatar,
                altText: "Brown Student Radio logo",
                expectedOrganizationRevision: 4
            )
        let input =
            Operations.ReserveOrganizationMediaUpload.Input(
                path: .init(id: "brown-student-radio"),
                body: .json(request)
            )

        XCTAssertEqual(
            Operations.ReserveOrganizationMediaUpload.id,
            "reserveOrganizationMediaUpload"
        )
        XCTAssertNil(request.expectedGalleryRevision)
        switch input.body {
        case let .json(body):
            XCTAssertEqual(body, request)
        }
    }
}
