import BrownSyncAPI
import Foundation
import XCTest

@testable import BrownSync

final class OrganizationSocialCardRepositoryREDTests: XCTestCase {
    func testCanonicalInstagramPermalinkCorpus() throws {
        let accepted: [(String, String)] = [
            (
                "https://instagram.com/p/Abc_123-/?utm_source=share&igsh=abc",
                "https://www.instagram.com/p/Abc_123-/"
            ),
            (
                "https://www.instagram.com/reel/xyz/",
                "https://www.instagram.com/reel/xyz/"
            ),
        ]
        for (input, expected) in accepted {
            XCTAssertEqual(
                try InstagramPermalink(input).url.absoluteString,
                expected
            )
        }

        let rejected = [
            "http://www.instagram.com/p/abc/",
            "https://instagram.com.evil.example/p/abc/",
            "https://user@www.instagram.com/p/abc/",
            "https://www.instagram.com:443/p/abc/",
            "https://www.instagram.com/p/abc/#fragment",
            "https://www.instagram.com/p/abc/?unknown=true",
            "https://www.instagram.com/p/abc/?igsh=a&igsh=b",
            "https://www.instagram.com/p%2Fabc/",
            "https://www.instagram.com/p/abc/extra",
            "https://www.instagram.com/stories/account/1/",
            "https://www.instagram.com/account/",
            " https://www.instagram.com/p/abc/",
            "https:\\\\www.instagram.com\\p\\abc",
        ]
        for value in rejected {
            XCTAssertThrowsError(try InstagramPermalink(value))
        }
    }

    func testPublicLinkOnlyCardsLoadSignedOutAndCacheSafely()
        async throws
    {
        let transport = Phase5OrgMediaTransport()
        await transport.enqueue(
            operationID: "listOrganizationSocialPosts",
            status: 200,
            body: socialCollectionJSON(renderMode: "link")
        )
        let repository = makeRepository(transport: transport)

        let first = try await repository.posts(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .useCache
        )
        let cached = try await repository.posts(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .useCache
        )

        XCTAssertEqual(first.source, .network)
        XCTAssertEqual(cached.source, .cache)
        XCTAssertEqual(first.value.posts[0].renderMode, .link)
        XCTAssertNil(first.value.posts[0].embedURL)
        XCTAssertEqual(
            first.value.posts[0].permalink.absoluteString,
            "https://www.instagram.com/p/Abc_123-/"
        )
        let recordCount = await transport.records().count
        XCTAssertEqual(recordCount, 1)
    }

    func testAddUsesStableUUIDCanonicalURLAndGeneratedOperation()
        async throws
    {
        let transport = Phase5OrgMediaTransport()
        await transport.enqueue(
            operationID: "addOrganizationSocialPost",
            status: 201,
            body: """
                {
                  "post":\(socialPostJSON(renderMode: "link")),
                  "replayed":true
                }
                """
        )
        let repository = makeRepository(transport: transport)
        let permalink = try InstagramPermalink(
            "https://instagram.com/p/Abc_123-/?igsh=share"
        )

        let result = try await repository.add(
            organizationID: Phase5OrgMediaFixture.organizationID,
            clientRequestID: Phase5OrgMediaFixture.requestID,
            permalink: permalink.url
        )

        XCTAssertTrue(result.replayed)
        let records = await transport.records()
        let record = try XCTUnwrap(records.first)
        XCTAssertEqual(
            record.operationID,
            "addOrganizationSocialPost"
        )
        XCTAssertEqual(record.method, "POST")
        let object = try jsonObject(record.body)
        XCTAssertEqual(
            object["clientRequestId"] as? String,
            Phase5OrgMediaFixture.requestID.uuidString.lowercased()
        )
        XCTAssertEqual(
            object["permalink"] as? String,
            "https://www.instagram.com/p/Abc_123-/"
        )
        XCTAssertFalse(
            String(decoding: record.body, as: UTF8.self)
                .contains("renderHtml")
        )
    }

    func testRefreshIsBodylessAndNeverRetries() async throws {
        let transport = Phase5OrgMediaTransport()
        await transport.enqueue(
            operationID: "refreshOrganizationSocialPost",
            status: 200,
            body: """
                {
                  "post":\(socialPostJSON(renderMode: "link")),
                  "changed":false
                }
                """
        )
        let repository = makeRepository(transport: transport)

        let result = try await repository.refresh(
            organizationID: Phase5OrgMediaFixture.organizationID,
            postID: Phase5OrgMediaFixture.postID
        )

        XCTAssertFalse(result.changed)
        let records = await transport.records()
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(
            records[0].operationID,
            "refreshOrganizationSocialPost"
        )
        XCTAssertEqual(records[0].method, "POST")
        XCTAssertTrue(records[0].body.isEmpty)
    }

    func testUnsafeEmbedProjectionFallsBackToCanonicalLinkCard()
        async throws
    {
        let transport = Phase5OrgMediaTransport()
        await transport.enqueue(
            operationID: "listOrganizationSocialPosts",
            status: 200,
            body: socialCollectionJSON(
                renderMode: "embed",
                embedURL:
                    "https://www.instagram.com/p/Abc_123-/embed"
            )
        )
        let repository = makeRepository(transport: transport)

        let value = try await repository.posts(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .reload
        ).value.posts[0]

        XCTAssertEqual(value.renderMode, .link)
        XCTAssertNil(value.embedURL)
        XCTAssertEqual(
            value.permalink.absoluteString,
            "https://www.instagram.com/p/Abc_123-/"
        )
    }

    @MainActor
    func testSocialDeleteIsOptimisticRestoresAndDoesNotRetry()
        async
    {
        let social = Phase5OrgSocialRepositoryFake()
        await social.failNext(with: .unavailable)
        let viewModel = OrganizationAssetsAdminViewModel(
            organizationID: Phase5OrgMediaFixture.organizationID,
            access: .admittedAdmin,
            media: Phase5OrgMediaFixture.collection(),
            socialPosts:
                Phase5OrgMediaFixture.socialCollection(),
            mediaRepository: Phase5OrgMediaRepositoryFake(),
            socialRepository: social
        )

        await viewModel.deleteSocialPost(
            id: Phase5OrgMediaFixture.postID
        )

        XCTAssertEqual(
            viewModel.socialPosts,
            Phase5OrgMediaFixture.socialCollection()
        )
        XCTAssertEqual(viewModel.lastError, .unavailable)
        let recordedCalls = await social.recordedCalls()
        XCTAssertEqual(
            recordedCalls,
            [
                .delete(
                    Phase5OrgMediaFixture.organizationID,
                    Phase5OrgMediaFixture.postID,
                    2
                )
            ]
        )
    }

    @MainActor
    func testTwelfthCardIsAllowedAndThirteenthIsBlockedLocally()
        async
    {
        let social = Phase5OrgSocialRepositoryFake()
        let posts = (0..<12).map { index in
            Phase5OrgMediaFixture.socialPost(
                id: UUID(),
                renderMode: .link,
                revision: index
            )
        }
        let viewModel = OrganizationAssetsAdminViewModel(
            organizationID: Phase5OrgMediaFixture.organizationID,
            access: .admittedAdmin,
            media: Phase5OrgMediaFixture.collection(),
            socialPosts:
                Phase5OrgMediaFixture.socialCollection(posts: posts),
            mediaRepository: Phase5OrgMediaRepositoryFake(),
            socialRepository: social
        )

        let allowed = viewModel.canAddSocialPost

        XCTAssertFalse(allowed)
        XCTAssertEqual(
            viewModel.lastError,
            .collectionLimitReached
        )
        let recordedCalls = await social.recordedCalls()
        XCTAssertTrue(recordedCalls.isEmpty)
    }

    func testPublicSocialDTORejectsRawProviderFields()
        async
    {
        let transport = Phase5OrgMediaTransport()
        await transport.enqueue(
            operationID: "listOrganizationSocialPosts",
            status: 200,
            body: """
                {
                  "organizationId":"\(Phase5OrgMediaFixture.organizationID)",
                  "posts":[{
                    "id":"\(Phase5OrgMediaFixture.postID.uuidString.lowercased())",
                    "permalink":"https://www.instagram.com/p/Abc_123-/",
                    "renderMode":"link",
                    "embedUrl":null,
                    "attribution":"Instagram",
                    "revision":2,
                    "renderHtml":"<script>provider()</script>",
                    "providerError":"secret"
                  }]
                }
                """
        )
        let repository = makeRepository(transport: transport)

        await assertThrowsSocialError(
            .invalidResponse,
            try await repository.posts(
                organizationID: Phase5OrgMediaFixture.organizationID,
                policy: .reload
            )
        )
    }

    func testSuccessfulSocialMutationsInvalidateOnlyTheAffectedPublicKey()
        async throws
    {
        let transport = Phase5OrgMediaTransport()
        for _ in 0..<4 {
            await transport.enqueue(
                operationID: "listOrganizationSocialPosts",
                status: 200,
                body: socialCollectionJSON(renderMode: "link")
            )
        }
        await transport.enqueue(
            operationID: "addOrganizationSocialPost",
            status: 201,
            body: """
                {
                  "post":\(socialPostJSON(renderMode: "link")),
                  "replayed":false
                }
                """
        )
        await transport.enqueue(
            operationID: "refreshOrganizationSocialPost",
            status: 200,
            body: """
                {
                  "post":\(socialPostJSON(renderMode: "link")),
                  "changed":true
                }
                """
        )
        await transport.enqueue(
            operationID: "deleteOrganizationSocialPost",
            status: 200,
            body: """
                {
                  "postId":"\(Phase5OrgMediaFixture.postID.uuidString.lowercased())",
                  "revision":3,
                  "changed":true
                }
                """
        )
        let cache = PublicResponseCache(
            directory: FileManager.default.temporaryDirectory
                .appendingPathComponent(
                    "Phase5OrgSocialCache-\(UUID().uuidString)",
                    isDirectory: true
                ),
            schemaVersion: 1
        )
        let unaffectedKey = "organization-social-posts:v1:another-org"
        try await cache.store(
            Phase5OrgMediaFixture.socialCollection(),
            forKey: unaffectedKey,
            storedAt: Phase5OrgMediaFixture.now
        )
        let repository = makeRepository(
            transport: transport,
            cache: cache
        )

        _ = try await repository.posts(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .useCache
        )
        _ = try await repository.add(
            organizationID: Phase5OrgMediaFixture.organizationID,
            clientRequestID: Phase5OrgMediaFixture.requestID,
            permalink: Phase5OrgMediaFixture.socialPost().permalink
        )
        let afterAdd = try await repository.posts(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .useCache
        )
        _ = try await repository.refresh(
            organizationID: Phase5OrgMediaFixture.organizationID,
            postID: Phase5OrgMediaFixture.postID
        )
        let afterRefresh = try await repository.posts(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .useCache
        )
        _ = try await repository.delete(
            organizationID: Phase5OrgMediaFixture.organizationID,
            postID: Phase5OrgMediaFixture.postID,
            expectedRevision: 2
        )
        let afterDelete = try await repository.posts(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .useCache
        )
        let unaffected: PublicCacheEntry<OrganizationSocialPostCollection>? =
            try await cache.entry(
                forKey: unaffectedKey,
                now: Phase5OrgMediaFixture.now,
                ttl: 300
            )

        XCTAssertEqual(afterAdd.source, .network)
        XCTAssertEqual(afterRefresh.source, .network)
        XCTAssertEqual(afterDelete.source, .network)
        XCTAssertNotNil(unaffected)
    }

    func testSocialPublicReadOmitsAuthorizationAndMutationIncludesBearer()
        async throws
    {
        let transport = Phase5OrgMediaTransport()
        await transport.enqueue(
            operationID: "listOrganizationSocialPosts",
            status: 200,
            body: socialCollectionJSON(renderMode: "link")
        )
        await transport.enqueue(
            operationID: "refreshOrganizationSocialPost",
            status: 200,
            body: """
                {
                  "post":\(socialPostJSON(renderMode: "link")),
                  "changed":false
                }
                """
        )
        let repository = makeRepository(transport: transport)

        _ = try await repository.posts(
            organizationID: Phase5OrgMediaFixture.organizationID,
            policy: .reload
        )
        _ = try await repository.refresh(
            organizationID: Phase5OrgMediaFixture.organizationID,
            postID: Phase5OrgMediaFixture.postID
        )

        let records = await transport.records()
        XCTAssertNil(records[0].authorization)
        XCTAssertEqual(
            records[1].authorization,
            "Bearer phase-5-social-token"
        )
    }

    private func makeRepository(
        transport: Phase5OrgMediaTransport,
        cache: PublicResponseCache? = nil
    ) -> WorkerOrganizationSocialPostRepository {
        let clients = WorkerAPIClients(
            baseURL: URL(
                string: "https://api.example.invalid"
            )!,
            tokenProvider: Phase5OrgSocialTokenProvider(),
            transport: transport
        )
        return WorkerOrganizationSocialPostRepository(
            publicClient: clients.publicClient,
            protectedClient: clients.protectedClient,
            cache: cache
                ?? PublicResponseCache(
                    directory: FileManager.default.temporaryDirectory
                        .appendingPathComponent(
                            "Phase5OrgSocialRED-\(UUID().uuidString)",
                            isDirectory: true
                        ),
                    schemaVersion: 1
                ),
            embedPolicy: OrganizationSocialEmbedPolicy(
                isolatedOrigin: URL(
                    string: "https://embeds.brownsync.example"
                )!
            ),
            logger: Phase5OrgMediaLogRecorder(),
            now: { Phase5OrgMediaFixture.now }
        )
    }

    private func socialCollectionJSON(
        renderMode: String,
        embedURL: String? = nil
    ) -> String {
        """
        {
          "organizationId":"\(Phase5OrgMediaFixture.organizationID)",
          "posts":[\(socialPostJSON(
              renderMode: renderMode,
              embedURL: embedURL
          ))]
        }
        """
    }

    private func socialPostJSON(
        renderMode: String,
        embedURL: String? = nil
    ) -> String {
        let resolvedEmbedURL: String?
        if renderMode == "embed" {
            resolvedEmbedURL =
                embedURL
                ?? "https://embeds.brownsync.example/api/social-posts/\(Phase5OrgMediaFixture.postID.uuidString.lowercased())/embed"
        } else {
            resolvedEmbedURL = nil
        }
        let embedJSON =
            resolvedEmbedURL.map { "\"\($0)\"" }
            ?? "null"
        return """
            {
              "id":"\(Phase5OrgMediaFixture.postID.uuidString.lowercased())",
              "permalink":"https://www.instagram.com/p/Abc_123-/",
              "renderMode":"\(renderMode)",
              "embedUrl":\(embedJSON),
              "attribution":"Instagram",
              "revision":2
            }
            """
    }

    private func jsonObject(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(
            JSONSerialization.jsonObject(with: data)
                as? [String: Any]
        )
    }
}

private struct Phase5OrgSocialTokenProvider: AccessTokenProviding {
    func accessToken() async throws -> String {
        "phase-5-social-token"
    }
}

private func assertThrowsSocialError<T>(
    _ expected: OrganizationAssetError,
    _ expression: @autoclosure () async throws -> T,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail(
            "Expected \(expected)",
            file: file,
            line: line
        )
    } catch {
        XCTAssertEqual(
            error as? OrganizationAssetError,
            expected,
            file: file,
            line: line
        )
    }
}
