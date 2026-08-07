import BrownSyncAPI
import Foundation
import OpenAPIRuntime
import XCTest

final class OrgMediaGeneratedOperationsREDTests: XCTestCase {
    func testEveryFrozenTask5EOperationRemainsGenerated() {
        let operations: [Any.Type] = [
            Operations.GetOrganizationMedia.self,
            Operations.ReserveOrganizationMediaUpload.self,
            Operations.UploadOrganizationMedia.self,
            Operations.DeleteOrganizationMedia.self,
            Operations.ReorderOrganizationGallery.self,
            Operations.ListOrganizationSocialPosts.self,
            Operations.AddOrganizationSocialPost.self,
            Operations.RefreshOrganizationSocialPost.self,
            Operations.DeleteOrganizationSocialPost.self,
            Operations.GetOrganizationSocialEmbed.self,
        ]

        XCTAssertEqual(operations.count, 10)
    }

    func testFrozenOperationIDsRemainExact() {
        XCTAssertEqual(
            [
                Operations.GetOrganizationMedia.id,
                Operations.ReserveOrganizationMediaUpload.id,
                Operations.UploadOrganizationMedia.id,
                Operations.DeleteOrganizationMedia.id,
                Operations.ReorderOrganizationGallery.id,
                Operations.ListOrganizationSocialPosts.id,
                Operations.AddOrganizationSocialPost.id,
                Operations.RefreshOrganizationSocialPost.id,
                Operations.DeleteOrganizationSocialPost.id,
                Operations.GetOrganizationSocialEmbed.id,
            ],
            [
                "getOrganizationMedia",
                "reserveOrganizationMediaUpload",
                "uploadOrganizationMedia",
                "deleteOrganizationMedia",
                "reorderOrganizationGallery",
                "listOrganizationSocialPosts",
                "addOrganizationSocialPost",
                "refreshOrganizationSocialPost",
                "deleteOrganizationSocialPost",
                "getOrganizationSocialEmbed",
            ]
        )
    }

    func testGeneratedUploadBodyHasOnlyThreeBinaryCases() {
        func requireExhaustiveSwitch(
            _ body: Operations.UploadOrganizationMedia.Input.Body
        ) -> HTTPBody {
            switch body {
            case .jpeg(let value):
                value
            case .png(let value):
                value
            case .imageWebp(let value):
                value
            }
        }

        let bytes = HTTPBody(Data([0x01]))
        XCTAssertNotNil(requireExhaustiveSwitch(.jpeg(bytes)))
        XCTAssertNotNil(requireExhaustiveSwitch(.png(bytes)))
        XCTAssertNotNil(requireExhaustiveSwitch(.imageWebp(bytes)))
    }

    func testGeneratedMediaCollectionMustExposeAvatarAndBanner() {
        func requireNullableReadyAssets(
            _ value: Components.Schemas.OrgMediaCollection
        ) {
            let _: Components.Schemas.NullableOrgMediaAsset? =
                value.avatar
            let _: Components.Schemas.NullableOrgMediaAsset? =
                value.banner
        }

        _ = requireNullableReadyAssets
    }

    func testGeneratedMediaCollectionDecodesRequiredObjectAndNullValues()
        throws
    {
        let avatarObject = try JSONDecoder().decode(
            Components.Schemas.OrgMediaCollection.self,
            from: Data(
                collectionJSON(
                    avatar: assetJSON(kind: "avatar"),
                    banner: "null"
                ).utf8
            )
        )
        let bannerObject = try JSONDecoder().decode(
            Components.Schemas.OrgMediaCollection.self,
            from: Data(
                collectionJSON(
                    avatar: "null",
                    banner: assetJSON(kind: "banner")
                ).utf8
            )
        )

        XCTAssertNotNil(avatarObject.avatar)
        XCTAssertNil(avatarObject.banner)
        XCTAssertNil(bannerObject.avatar)
        XCTAssertNotNil(bannerObject.banner)
    }

    func testGeneratedNullableAssetPreservesNonNullPositionForDomainValidation()
        throws
    {
        let nonNullPosition = assetJSON(kind: "avatar")
            .replacingOccurrences(
                of: #""position":null"#,
                with: #""position":0"#
            )

        let decoded = try JSONDecoder().decode(
            Components.Schemas.OrgMediaCollection.self,
            from: Data(
                collectionJSON(
                    avatar: nonNullPosition,
                    banner: "null"
                ).utf8
            )
        )
        XCTAssertEqual(decoded.avatar?.position, 0)
    }

    func testReservationRequestKeepsRelevantAndOmitsIrrelevantRevision()
        throws
    {
        let avatar = Components.Schemas.OrgMediaUploadReservationRequest(
            clientRequestId:
                Phase5OrgMediaFixture.requestID.uuidString.lowercased(),
            kind: .avatar,
            altText: "Brown Student Radio logo",
            expectedOrganizationRevision: 4,
            expectedGalleryRevision: nil
        )
        let gallery = Components.Schemas.OrgMediaUploadReservationRequest(
            clientRequestId:
                Phase5OrgMediaFixture.secondRequestID.uuidString.lowercased(),
            kind: .gallery,
            altText: "Students broadcasting",
            expectedOrganizationRevision: nil,
            expectedGalleryRevision: 7
        )

        let avatarObject = try jsonObject(avatar)
        let galleryObject = try jsonObject(gallery)

        XCTAssertEqual(
            avatarObject["expectedOrganizationRevision"] as? Int,
            4
        )
        XCTAssertFalse(
            avatarObject.keys.contains("expectedGalleryRevision")
        )
        XCTAssertFalse(
            galleryObject.keys.contains(
                "expectedOrganizationRevision"
            )
        )
        XCTAssertEqual(
            galleryObject["expectedGalleryRevision"] as? Int,
            7
        )
    }

    func testGalleryReorderRequestIsTheCompleteTypedIDArray() {
        let request = Components.Schemas.OrgGalleryReorderRequest(
            expectedGalleryRevision: 7,
            mediaIds: [
                Phase5OrgMediaFixture.secondGalleryID.uuidString
                    .lowercased(),
                Phase5OrgMediaFixture.galleryID.uuidString.lowercased(),
            ]
        )

        XCTAssertEqual(request.expectedGalleryRevision, 7)
        XCTAssertEqual(request.mediaIds.count, 2)
    }

    func testSocialGeneratedSurfaceContainsNoProviderHTML() {
        let post = Components.Schemas.OrgSocialPost(
            id: Phase5OrgMediaFixture.postID.uuidString.lowercased(),
            permalink: "https://www.instagram.com/p/Abc_123-/",
            renderMode: .link,
            embedUrl: nil,
            attribution: "Instagram",
            revision: 2
        )

        XCTAssertEqual(post.renderMode, .link)
        XCTAssertNil(post.embedUrl)
        XCTAssertEqual(
            Set(Components.Schemas.OrgSocialRenderMode.allCases),
            [.link, .embed]
        )
    }

    func testEmbedSuccessRemainsAnIsolatedHTMLBody() {
        func requireHTML(
            _ body:
                Operations.GetOrganizationSocialEmbed.Output.Ok.Body
        ) -> HTTPBody {
            switch body {
            case .html(let value):
                value
            }
        }

        XCTAssertNotNil(requireHTML(.html(HTTPBody("<p>safe</p>"))))
    }

    func testRefreshInputHasPathOnlyAndNoBody() {
        let input = Operations.RefreshOrganizationSocialPost.Input(
            path: .init(
                id: Phase5OrgMediaFixture.organizationID,
                postId:
                    Phase5OrgMediaFixture.postID.uuidString.lowercased()
            )
        )

        XCTAssertEqual(
            input.path.postId,
            Phase5OrgMediaFixture.postID.uuidString.lowercased()
        )
    }

    private func jsonObject<Value: Encodable>(
        _ value: Value
    ) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        return try XCTUnwrap(
            JSONSerialization.jsonObject(with: data)
                as? [String: Any]
        )
    }

    private func collectionJSON(
        avatar: String,
        banner: String
    ) -> String {
        """
        {
          "organizationId":"\(Phase5OrgMediaFixture.organizationID)",
          "organizationRevision":4,
          "galleryRevision":7,
          "avatar":\(avatar),
          "banner":\(banner),
          "gallery":[]
        }
        """
    }

    private func assetJSON(kind: String) -> String {
        """
        {
          "id":"\(Phase5OrgMediaFixture.avatarID.uuidString.lowercased())",
          "kind":"\(kind)",
          "url":"https://media.brownsync.example/\(kind).webp",
          "width":1024,
          "height":1024,
          "byteSize":120000,
          "altText":"Brown Student Radio \(kind)",
          "position":null,
          "revision":1
        }
        """
    }
}
