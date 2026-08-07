import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

final class OrganizationMediaRepositoryREDTests: XCTestCase {
    func testPublicReadyCollectionLoadsSignedOutAndUsesOnlySafeDiskCache()
        async throws
    {
        let transport = Phase5OrgMediaTransport()
        await transport.enqueue(
            operationID: "getOrganizationMedia",
            status: 200,
            body: mediaCollectionJSON()
        )
        let cache = PublicResponseCache(
            directory: temporaryCacheDirectory(),
            schemaVersion: 1
        )
        let repository = makeRepository(
            transport: transport,
            cache: cache
        )

        let first = try await repository.media(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .useCache
        )
        let second = try await repository.media(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .useCache
        )

        XCTAssertEqual(first.source, .network)
        XCTAssertEqual(second.source, .cache)
        XCTAssertEqual(first.value, second.value)
        XCTAssertEqual(first.value.gallery.count, 2)
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            ["getOrganizationMedia"]
        )
    }

    func testReservationUsesOneGeneratedRequestAndExactRevisionPair()
        async throws
    {
        let transport = Phase5OrgMediaTransport()
        await transport.enqueue(
            operationID: "reserveOrganizationMediaUpload",
            status: 201,
            body: reservationJSON()
        )
        let repository = makeRepository(transport: transport)
        let command = OrganizationMediaReservationCommand(
            clientRequestID: Phase5OrgMediaFixture.requestID,
            kind: .gallery,
            altText: "Students broadcasting from the studio",
            expectedOrganizationRevision: nil,
            expectedGalleryRevision: 7
        )

        let reservation = try await repository.reserveUpload(
            organizationID: Phase5OrgMediaFixture.organizationID,
            command: command
        )

        XCTAssertEqual(
            reservation.uploadID,
            Phase5OrgMediaFixture.uploadID
        )
        let records = await transport.records()
        let record = try XCTUnwrap(records.only)
        XCTAssertEqual(
            record.operationID,
            "reserveOrganizationMediaUpload"
        )
        XCTAssertEqual(record.method, "POST")
        XCTAssertEqual(
            record.path,
            "/api/orgs/\(Phase5OrgMediaFixture.organizationID)/media/uploads"
        )
        let object = try jsonObject(record.body)
        XCTAssertEqual(
            object["clientRequestId"] as? String,
            Phase5OrgMediaFixture.requestID.uuidString.lowercased()
        )
        XCTAssertFalse(
            object.keys.contains(
                "expectedOrganizationRevision"
            )
        )
        XCTAssertEqual(
            object["expectedGalleryRevision"] as? Int,
            7
        )
    }

    func testUploadMapsJPEGPNGAndWebPToGeneratedBinaryCases()
        async throws
    {
        let cases:
            [(
                OrganizationMediaContentType,
                String
            )] = [
                (.jpeg, "image/jpeg"),
                (.png, "image/png"),
                (.webP, "image/webp"),
            ]

        for (contentType, expectedHeader) in cases {
            let transport = Phase5OrgMediaTransport()
            await transport.enqueue(
                operationID: "uploadOrganizationMedia",
                status: 201,
                body: uploadResultJSON()
            )
            let store = Phase5OrgMediaProtectedStoreFake(
                prepared: Phase5OrgMediaFixture.prepared(
                    contentType: contentType
                ),
                bytes: Data([0x01, 0x02, 0x03])
            )
            let repository = makeRepository(
                transport: transport,
                protectedStore: store
            )

            _ = try await repository.uploadReserved(
                Phase5OrgMediaFixture.reservation(),
                prepared: Phase5OrgMediaFixture.prepared(
                    contentType: contentType
                )
            )

            let records = await transport.records()
            let record = try XCTUnwrap(records.only)
            XCTAssertEqual(
                record.operationID,
                "uploadOrganizationMedia"
            )
            XCTAssertEqual(record.method, "PUT")
            XCTAssertEqual(
                record.path,
                "/api/org-media/uploads/\(Phase5OrgMediaFixture.uploadID.uuidString.lowercased())"
            )
            XCTAssertEqual(record.contentType, expectedHeader)
            XCTAssertEqual(record.body, Data([0x01, 0x02, 0x03]))
        }
    }

    func testServerRemainsAuthoritativeForUploadValidationStatuses()
        async throws
    {
        let cases: [(Int, OrganizationAssetError)] = [
            (409, .conflict),
            (413, .payloadTooLarge),
            (415, .unsupportedMedia),
            (422, .invalidMedia),
            (429, .quotaExceeded),
            (503, .unavailable),
        ]

        for (status, expected) in cases {
            let transport = Phase5OrgMediaTransport()
            await transport.enqueue(
                operationID: "uploadOrganizationMedia",
                status: status,
                body: errorJSON(status: status)
            )
            let repository = makeRepository(transport: transport)

            await assertThrowsErrorAsync(
                try await repository.uploadReserved(
                    Phase5OrgMediaFixture.reservation(),
                    prepared: Phase5OrgMediaFixture.prepared()
                )
            ) { error in
                XCTAssertEqual(error as? OrganizationAssetError, expected)
            }
            let recordCount = await transport.records().count
            XCTAssertEqual(
                recordCount,
                1,
                "Validation failures must not trigger a client retry."
            )
        }
    }

    func testWorkerStillAuthoritativelyMapsAuthenticationAndAdminErrors()
        async
    {
        let cases: [(Int, String, OrganizationAssetError)] = [
            (
                401,
                "authentication_required",
                .authenticationRequired
            ),
            (
                403,
                "brown_membership_required",
                .brownMembershipRequired
            ),
            (
                403,
                "organization_admin_required",
                .authorityRequired
            ),
        ]

        for (status, code, expected) in cases {
            let transport = Phase5OrgMediaTransport()
            await transport.enqueue(
                operationID: "reserveOrganizationMediaUpload",
                status: status,
                body: errorJSON(status: status, code: code)
            )
            let repository = makeRepository(transport: transport)

            await assertThrowsErrorAsync(
                try await repository.reserveUpload(
                    organizationID:
                        Phase5OrgMediaFixture.organizationID,
                    command: OrganizationMediaReservationCommand(
                        clientRequestID:
                            Phase5OrgMediaFixture.requestID,
                        kind: .gallery,
                        altText: "Students broadcasting",
                        expectedOrganizationRevision: nil,
                        expectedGalleryRevision: 7
                    )
                )
            ) { error in
                XCTAssertEqual(
                    error as? OrganizationAssetError,
                    expected
                )
            }
            let recordCount = await transport.records().count
            XCTAssertEqual(recordCount, 1)
        }
    }

    func testUploadRejectsWrongKindRevisionPairAsInvalidResponse()
        async throws
    {
        let transport = Phase5OrgMediaTransport()
        await transport.enqueue(
            operationID: "uploadOrganizationMedia",
            status: 201,
            body: uploadResultJSON(
                organizationRevision: 5,
                galleryRevision: 8
            )
        )
        let repository = makeRepository(transport: transport)

        await assertThrowsErrorAsync(
            try await repository.uploadReserved(
                Phase5OrgMediaFixture.reservation(),
                prepared: Phase5OrgMediaFixture.prepared()
            )
        ) { error in
            XCTAssertEqual(
                error as? OrganizationAssetError,
                .invalidResponse
            )
        }
        let recordCount = await transport.records().count
        XCTAssertEqual(recordCount, 1)
    }

    func testDeleteAndReorderUseGeneratedMutationsWithoutRetry()
        async throws
    {
        let transport = Phase5OrgMediaTransport()
        await transport.enqueue(
            operationID: "deleteOrganizationMedia",
            status: 200,
            body: deleteResultJSON()
        )
        await transport.enqueue(
            operationID: "reorderOrganizationGallery",
            status: 200,
            body: """
                {"galleryRevision":9,"changed":true}
                """
        )
        let repository = makeRepository(transport: transport)

        _ = try await repository.deleteMedia(
            organizationID: Phase5OrgMediaFixture.organizationID,
            mediaID: Phase5OrgMediaFixture.galleryID,
            expectedRevision: 7
        )
        _ = try await repository.reorderGallery(
            organizationID: Phase5OrgMediaFixture.organizationID,
            mediaIDs: [
                Phase5OrgMediaFixture.secondGalleryID,
                Phase5OrgMediaFixture.galleryID,
            ],
            expectedGalleryRevision: 8
        )

        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            [
                "deleteOrganizationMedia",
                "reorderOrganizationGallery",
            ]
        )
        XCTAssertEqual(
            try jsonObject(records[0].body)["expectedRevision"]
                as? Int,
            7
        )
        let reorder = try jsonObject(records[1].body)
        XCTAssertEqual(
            reorder["expectedGalleryRevision"] as? Int,
            8
        )
        XCTAssertEqual(
            reorder["mediaIds"] as? [String],
            [
                Phase5OrgMediaFixture.secondGalleryID.uuidString
                    .lowercased(),
                Phase5OrgMediaFixture.galleryID.uuidString.lowercased(),
            ]
        )
    }

    func testPublicProjectionRejectsUnsafeURLsAndMalformedOrder()
        async throws
    {
        let payloads = [
            mediaCollectionJSON(
                galleryURL: "http://media.example.invalid/a.webp"
            ),
            mediaCollectionJSON(
                secondPosition: 0
            ),
        ]

        for payload in payloads {
            let transport = Phase5OrgMediaTransport()
            await transport.enqueue(
                operationID: "getOrganizationMedia",
                status: 200,
                body: payload
            )
            let repository = makeRepository(transport: transport)

            await assertThrowsErrorAsync(
                try await repository.media(
                    organizationID:
                        Phase5OrgMediaFixture.organizationID,
                    policy: .reload
                )
            ) { error in
                XCTAssertEqual(
                    error as? OrganizationAssetError,
                    .invalidResponse
                )
            }
        }
    }

    func testPublicProjectionRejectsPositionLaunderingAndCrossSlotIDs()
        async
    {
        let payloads = [
            mediaCollectionJSON(avatarPosition: 0),
            mediaCollectionJSON(
                firstGalleryID: Phase5OrgMediaFixture.avatarID
            ),
        ]

        for payload in payloads {
            let transport = Phase5OrgMediaTransport()
            await transport.enqueue(
                operationID: "getOrganizationMedia",
                status: 200,
                body: payload
            )
            let repository = makeRepository(transport: transport)

            await assertThrowsErrorAsync(
                try await repository.media(
                    organizationID:
                        Phase5OrgMediaFixture.organizationID,
                    policy: .reload
                )
            ) { error in
                XCTAssertEqual(
                    error as? OrganizationAssetError,
                    .invalidResponse
                )
            }
        }
    }

    func testSuccessfulMediaMutationsInvalidateOnlyTheAffectedPublicKey()
        async throws
    {
        let transport = Phase5OrgMediaTransport()
        for _ in 0..<4 {
            await transport.enqueue(
                operationID: "getOrganizationMedia",
                status: 200,
                body: mediaCollectionJSON()
            )
        }
        await transport.enqueue(
            operationID: "deleteOrganizationMedia",
            status: 200,
            body: deleteResultJSON()
        )
        await transport.enqueue(
            operationID: "reorderOrganizationGallery",
            status: 200,
            body: #"{"galleryRevision":9,"changed":true}"#
        )
        await transport.enqueue(
            operationID: "uploadOrganizationMedia",
            status: 201,
            body: uploadResultJSON()
        )
        let cache = PublicResponseCache(
            directory: temporaryCacheDirectory(),
            schemaVersion: 1
        )
        let unaffectedKey = "organization-media:v1:another-org"
        try await cache.store(
            Phase5OrgMediaFixture.collection(),
            forKey: unaffectedKey,
            storedAt: Phase5OrgMediaFixture.now
        )
        let repository = makeRepository(
            transport: transport,
            cache: cache
        )

        _ = try await repository.media(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .useCache
        )
        _ = try await repository.deleteMedia(
            organizationID: Phase5OrgMediaFixture.organizationID,
            mediaID: Phase5OrgMediaFixture.galleryID,
            expectedRevision: 7
        )
        let afterDelete = try await repository.media(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .useCache
        )
        _ = try await repository.reorderGallery(
            organizationID: Phase5OrgMediaFixture.organizationID,
            mediaIDs: [
                Phase5OrgMediaFixture.secondGalleryID,
                Phase5OrgMediaFixture.galleryID,
            ],
            expectedGalleryRevision: 8
        )
        let afterReorder = try await repository.media(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .useCache
        )
        _ = try await repository.uploadReserved(
            Phase5OrgMediaFixture.reservation(),
            prepared: Phase5OrgMediaFixture.prepared()
        )
        let afterUpload = try await repository.media(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .useCache
        )
        let unaffected: PublicCacheEntry<OrganizationMediaCollection>? =
            try await cache.entry(
                forKey: unaffectedKey,
                now: Phase5OrgMediaFixture.now,
                ttl: 300
            )

        XCTAssertEqual(afterDelete.source, .network)
        XCTAssertEqual(afterReorder.source, .network)
        XCTAssertEqual(afterUpload.source, .network)
        XCTAssertNotNil(unaffected)
        let records = await transport.records()
        XCTAssertEqual(
            records.map(\.operationID),
            [
                "getOrganizationMedia",
                "deleteOrganizationMedia",
                "getOrganizationMedia",
                "reorderOrganizationGallery",
                "getOrganizationMedia",
                "uploadOrganizationMedia",
                "getOrganizationMedia",
            ]
        )
    }

    func testPublicReadOmitsAuthorizationAndMutationIncludesBearer()
        async throws
    {
        let transport = Phase5OrgMediaTransport()
        await transport.enqueue(
            operationID: "getOrganizationMedia",
            status: 200,
            body: mediaCollectionJSON()
        )
        await transport.enqueue(
            operationID: "deleteOrganizationMedia",
            status: 200,
            body: deleteResultJSON()
        )
        let repository = makeRepository(transport: transport)

        _ = try await repository.media(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .reload
        )
        _ = try await repository.deleteMedia(
            organizationID: Phase5OrgMediaFixture.organizationID,
            mediaID: Phase5OrgMediaFixture.galleryID,
            expectedRevision: 7
        )

        let records = await transport.records()
        XCTAssertNil(records[0].authorization)
        XCTAssertEqual(
            records[1].authorization,
            "Bearer phase-5-token"
        )
    }

    private func makeRepository(
        transport: Phase5OrgMediaTransport,
        cache: PublicResponseCache? = nil,
        protectedStore:
            Phase5OrgMediaProtectedStoreFake? = nil
    ) -> WorkerOrganizationMediaRepository {
        let clients = WorkerAPIClients(
            baseURL: URL(
                string: "https://api.example.invalid"
            )!,
            tokenProvider: Phase5OrgMediaTokenProvider(),
            transport: transport
        )
        return WorkerOrganizationMediaRepository(
            publicClient: clients.publicClient,
            protectedClient: clients.protectedClient,
            cache: cache
                ?? PublicResponseCache(
                    directory: temporaryCacheDirectory(),
                    schemaVersion: 1
                ),
            protectedStore: protectedStore
                ?? Phase5OrgMediaProtectedStoreFake(),
            logger: Phase5OrgMediaLogRecorder(),
            now: { Phase5OrgMediaFixture.now }
        )
    }

    private func temporaryCacheDirectory() -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "Phase5OrgMediaRED-\(UUID().uuidString)",
                isDirectory: true
            )
    }

    private func mediaCollectionJSON(
        galleryURL: String =
            "https://media.brownsync.example/gallery-a.webp",
        secondPosition: Int = 1,
        avatarPosition: Int? = nil,
        firstGalleryID: UUID = Phase5OrgMediaFixture.galleryID
    ) -> String {
        """
        {
          "organizationId":"\(Phase5OrgMediaFixture.organizationID)",
          "organizationRevision":4,
          "galleryRevision":7,
          "avatar":\(assetJSON(
              id: Phase5OrgMediaFixture.avatarID,
              kind: "avatar",
              url: "https://media.brownsync.example/avatar.webp",
              position: avatarPosition
          )),
          "banner":null,
          "gallery":[
            \(assetJSON(
                id: firstGalleryID,
                kind: "gallery",
                url: galleryURL,
                position: 0
            )),
            \(assetJSON(
                id: Phase5OrgMediaFixture.secondGalleryID,
                kind: "gallery",
                url: "https://media.brownsync.example/gallery-b.webp",
                position: secondPosition
            ))
          ]
        }
        """
    }

    private func assetJSON(
        id: UUID,
        kind: String,
        url: String,
        position: Int?
    ) -> String {
        let positionJSON =
            position.map {
                #","position":\#($0)"#
            } ?? ""
        return """
            {
              "id":"\(id.uuidString.lowercased())",
              "kind":"\(kind)",
              "url":"\(url)",
              "width":1024,
              "height":1024,
              "byteSize":120000,
              "altText":"Students broadcasting from the studio"\(positionJSON),
              "revision":1
            }
            """
    }

    private func reservationJSON() -> String {
        """
        {
          "uploadId":"\(Phase5OrgMediaFixture.uploadID.uuidString.lowercased())",
          "kind":"gallery",
          "expiresAt":"2027-01-15T08:10:00Z",
          "replayed":false
        }
        """
    }

    private func uploadResultJSON(
        organizationRevision: Int? = nil,
        galleryRevision: Int? = 8
    ) -> String {
        """
        {
          "asset":\(assetJSON(
              id: Phase5OrgMediaFixture.galleryID,
              kind: "gallery",
              url: "https://media.brownsync.example/gallery-a.webp",
              position: 0
          )),
          "organizationRevision":\(jsonNumber(organizationRevision)),
          "galleryRevision":\(jsonNumber(galleryRevision))
        }
        """
    }

    private func deleteResultJSON() -> String {
        """
        {
          "mediaId":"\(Phase5OrgMediaFixture.galleryID.uuidString.lowercased())",
          "kind":"gallery",
          "organizationRevision":null,
          "galleryRevision":8,
          "changed":true
        }
        """
    }

    private func errorJSON(
        status: Int,
        code: String = "task_5e_error"
    ) -> String {
        """
        {"error":{"code":"\(code)","message":"\(status)"}}
        """
    }

    private func jsonNumber(_ value: Int?) -> String {
        value.map(String.init) ?? "null"
    }

    private func jsonObject(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(
            JSONSerialization.jsonObject(with: data)
                as? [String: Any]
        )
    }
}

extension Array {
    fileprivate var only: Element? {
        count == 1 ? self[0] : nil
    }
}

private func assertThrowsErrorAsync<T>(
    _ expression: @autoclosure () async throws -> T,
    _ errorHandler: (Error) -> Void = { _ in },
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail(
            "Expected expression to throw",
            file: file,
            line: line
        )
    } catch {
        errorHandler(error)
    }
}

private struct Phase5OrgMediaTokenProvider: AccessTokenProviding {
    func accessToken() async throws -> String {
        "phase-5-token"
    }
}
