import BrownSyncAPI
import Foundation
import OpenAPIRuntime

struct InstagramPermalink: Equatable, Sendable {
    let url: URL

    init(_ value: String) throws {
        guard
            !value.isEmpty,
            value.count <= 2_048,
            value.trimmingCharacters(in: .whitespacesAndNewlines)
                == value,
            value.hasPrefix("https://"),
            !value.contains("\\"),
            !value
                .dropFirst("https://".count)
                .prefix(while: { !"/?#".contains($0) })
                .contains(":"),
            let components = URLComponents(string: value),
            components.scheme == "https",
            components.host == "instagram.com"
                || components.host == "www.instagram.com",
            components.user == nil,
            components.password == nil,
            components.port == nil,
            components.fragment == nil,
            !components.percentEncodedPath.contains("%")
        else {
            throw OrganizationAssetError.unsafeURL
        }

        let path = components.percentEncodedPath
        let parts = path.split(separator: "/")
        guard
            parts.count == 2,
            parts[0] == "p" || parts[0] == "reel",
            (1...64).contains(parts[1].count),
            parts[1].unicodeScalars.allSatisfy({
                CharacterSet(
                    charactersIn:
                        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
                ).contains($0)
            }),
            path == "/\(parts[0])/\(parts[1])"
                || path == "/\(parts[0])/\(parts[1])/"
        else {
            throw OrganizationAssetError.unsafeURL
        }

        let safeQueryKeys: Set<String> = [
            "igsh",
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_content",
            "utm_term",
        ]
        var seen = Set<String>()
        for item in components.queryItems ?? [] {
            guard
                safeQueryKeys.contains(item.name),
                seen.insert(item.name).inserted
            else {
                throw OrganizationAssetError.unsafeURL
            }
        }

        guard
            let canonical = URL(
                string:
                    "https://www.instagram.com/\(parts[0])/\(parts[1])/"
            )
        else {
            throw OrganizationAssetError.unsafeURL
        }
        url = canonical
    }
}

protocol OrganizationSocialPostRepository: Sendable {
    func posts(
        organizationID: String,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<OrganizationSocialPostCollection>

    func add(
        organizationID: String,
        clientRequestID: UUID,
        permalink: URL
    ) async throws -> OrganizationSocialPostCreateResult

    func refresh(
        organizationID: String,
        postID: UUID
    ) async throws -> OrganizationSocialPostRefreshResult

    func delete(
        organizationID: String,
        postID: UUID,
        expectedRevision: Int
    ) async throws -> OrganizationSocialPostDeleteResult
}

struct WorkerOrganizationSocialPostRepository:
    OrganizationSocialPostRepository,
    Sendable
{
    private let publicClient: BrownSyncAPI.Client
    private let protectedClient: BrownSyncAPI.Client
    private let cache: PublicResponseCache
    private let embedPolicy: OrganizationSocialEmbedPolicy
    private let logger: any OrganizationAssetLogSink
    private let nowProvider: @Sendable () -> Date

    init(
        publicClient: BrownSyncAPI.Client,
        protectedClient: BrownSyncAPI.Client,
        cache: PublicResponseCache,
        embedPolicy: OrganizationSocialEmbedPolicy,
        logger: any OrganizationAssetLogSink =
            NullOrganizationAssetLogSink(),
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.publicClient = publicClient
        self.protectedClient = protectedClient
        self.cache = cache
        self.embedPolicy = embedPolicy
        self.logger = logger
        nowProvider = now
    }

    func posts(
        organizationID: String,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<OrganizationSocialPostCollection> {
        guard !organizationID.isEmpty else {
            throw OrganizationAssetError.invalidResponse
        }
        let resource: PublicResource<OrganizationSocialPostCollection>
        do {
            resource = try await loadPublicResource(
                cache: cache,
                key: Self.publicCacheKey(organizationID),
                ttl: 5 * 60,
                policy: policy,
                now: nowProvider
            ) { [publicClient, embedPolicy] in
                do {
                    let output =
                        try await publicClient
                        .listOrganizationSocialPosts(
                            .init(path: .init(id: organizationID))
                        )
                    return try Self.collection(
                        from: output,
                        expectedOrganizationID: organizationID,
                        embedPolicy: embedPolicy
                    )
                } catch {
                    throw Self.normalizedClientError(error)
                }
            }
        } catch {
            throw Self.normalizedClientError(error)
        }
        await logger.record(.publicCardsLoaded(source: resource.source))
        return resource
    }

    func add(
        organizationID: String,
        clientRequestID: UUID,
        permalink: URL
    ) async throws -> OrganizationSocialPostCreateResult {
        guard !organizationID.isEmpty else {
            throw OrganizationAssetError.invalidResponse
        }
        let canonical = try InstagramPermalink(
            permalink.absoluteString
        ).url
        return try await runMutation(
            .socialAdd,
            invalidatingPublicKey: Self.publicCacheKey(organizationID)
        ) {
            [protectedClient] in
            let output =
                try await protectedClient
                .addOrganizationSocialPost(
                    .init(
                        path: .init(id: organizationID),
                        body: .json(
                            .init(
                                clientRequestId:
                                    clientRequestID.uuidString.lowercased(),
                                permalink: canonical.absoluteString
                            )
                        )
                    )
                )
            switch output {
            case .created(let response):
                switch response.body {
                case .json(let payload):
                    return OrganizationSocialPostCreateResult(
                        post: try Self.post(
                            from: payload.post,
                            embedPolicy: embedPolicy
                        ),
                        replayed: payload.replayed
                    )
                }
            case .badRequest:
                throw OrganizationAssetError.unsafeURL
            case .unauthorized:
                throw OrganizationAssetError.authenticationRequired
            case .forbidden(let response):
                switch response.body {
                case .json(let payload):
                    throw Self.forbiddenError(
                        code: payload.error.code
                    )
                }
            case .notFound:
                throw OrganizationAssetError.notFound
            case .conflict:
                throw OrganizationAssetError.conflict
            case .tooManyRequests:
                throw OrganizationAssetError.quotaExceeded
            case .serviceUnavailable:
                throw OrganizationAssetError.unavailable
            case .undocumented(let statusCode, _):
                throw Self.error(status: statusCode)
            }
        }
    }

    func refresh(
        organizationID: String,
        postID: UUID
    ) async throws -> OrganizationSocialPostRefreshResult {
        guard !organizationID.isEmpty else {
            throw OrganizationAssetError.invalidResponse
        }
        return try await runMutation(
            .socialRefresh,
            invalidatingPublicKey: Self.publicCacheKey(organizationID)
        ) {
            [protectedClient] in
            let output =
                try await protectedClient
                .refreshOrganizationSocialPost(
                    .init(
                        path: .init(
                            id: organizationID,
                            postId: postID.uuidString.lowercased()
                        )
                    )
                )
            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    let post = try Self.post(
                        from: payload.post,
                        embedPolicy: embedPolicy
                    )
                    guard post.id == postID else {
                        throw OrganizationAssetError.invalidResponse
                    }
                    return OrganizationSocialPostRefreshResult(
                        post: post,
                        changed: payload.changed
                    )
                }
            case .badRequest:
                throw OrganizationAssetError.invalidResponse
            case .unauthorized:
                throw OrganizationAssetError.authenticationRequired
            case .forbidden(let response):
                switch response.body {
                case .json(let payload):
                    throw Self.forbiddenError(
                        code: payload.error.code
                    )
                }
            case .notFound:
                throw OrganizationAssetError.notFound
            case .conflict:
                throw OrganizationAssetError.conflict
            case .tooManyRequests:
                throw OrganizationAssetError.quotaExceeded
            case .serviceUnavailable:
                throw OrganizationAssetError.unavailable
            case .undocumented(let statusCode, _):
                throw Self.error(status: statusCode)
            }
        }
    }

    func delete(
        organizationID: String,
        postID: UUID,
        expectedRevision: Int
    ) async throws -> OrganizationSocialPostDeleteResult {
        guard !organizationID.isEmpty, expectedRevision >= 0 else {
            throw OrganizationAssetError.invalidResponse
        }
        return try await runMutation(
            .socialDelete,
            invalidatingPublicKey: Self.publicCacheKey(organizationID)
        ) {
            [protectedClient] in
            let output =
                try await protectedClient
                .deleteOrganizationSocialPost(
                    .init(
                        path: .init(
                            id: organizationID,
                            postId: postID.uuidString.lowercased()
                        ),
                        body: .json(
                            .init(expectedRevision: expectedRevision)
                        )
                    )
                )
            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    guard
                        let returnedID = UUID(
                            uuidString: payload.postId
                        ),
                        returnedID == postID,
                        payload.revision >= 0
                    else {
                        throw OrganizationAssetError.invalidResponse
                    }
                    return OrganizationSocialPostDeleteResult(
                        postID: returnedID,
                        revision: payload.revision,
                        changed: payload.changed
                    )
                }
            case .badRequest:
                throw OrganizationAssetError.invalidResponse
            case .unauthorized:
                throw OrganizationAssetError.authenticationRequired
            case .forbidden(let response):
                switch response.body {
                case .json(let payload):
                    throw Self.forbiddenError(
                        code: payload.error.code
                    )
                }
            case .notFound:
                throw OrganizationAssetError.notFound
            case .conflict:
                throw OrganizationAssetError.conflict
            case .tooManyRequests:
                throw OrganizationAssetError.quotaExceeded
            case .serviceUnavailable:
                throw OrganizationAssetError.unavailable
            case .undocumented(let statusCode, _):
                throw Self.error(status: statusCode)
            }
        }
    }

    private func runMutation<Value: Sendable>(
        _ kind: OrganizationAssetMutationKind,
        invalidatingPublicKey: String? = nil,
        operation: () async throws -> Value
    ) async throws -> Value {
        do {
            let value = try await operation()
            if let invalidatingPublicKey {
                await cache.remove(forKey: invalidatingPublicKey)
            }
            await logger.record(
                .mutationFinished(kind: kind, outcome: .succeeded)
            )
            return value
        } catch {
            let normalized = Self.normalizedClientError(error)
            await logger.record(
                .mutationFinished(
                    kind: kind,
                    outcome: Self.safeOutcome(for: normalized)
                )
            )
            throw normalized
        }
    }

    fileprivate static func publicCacheKey(
        _ organizationID: String
    ) -> String {
        "organization-social-posts:v1:\(organizationID)"
    }
}

extension WorkerOrganizationSocialPostRepository {
    fileprivate static func collection(
        from output: Operations.ListOrganizationSocialPosts.Output,
        expectedOrganizationID: String,
        embedPolicy: OrganizationSocialEmbedPolicy
    ) throws -> OrganizationSocialPostCollection {
        switch output {
        case .ok(let response):
            switch response.body {
            case .json(let payload):
                guard payload.organizationId == expectedOrganizationID else {
                    throw OrganizationAssetError.invalidResponse
                }
                let value = OrganizationSocialPostCollection(
                    organizationID: payload.organizationId,
                    posts: try payload.posts.map {
                        try post(
                            from: $0,
                            embedPolicy: embedPolicy
                        )
                    }
                )
                try value.validate()
                return value
            }
        case .badRequest:
            throw OrganizationAssetError.invalidResponse
        case .notFound:
            throw OrganizationAssetError.notFound
        case .tooManyRequests:
            throw OrganizationAssetError.quotaExceeded
        case .serviceUnavailable:
            throw OrganizationAssetError.unavailable
        case .undocumented(let statusCode, _):
            throw error(status: statusCode)
        }
    }

    fileprivate static func post(
        from payload: Components.Schemas.OrgSocialPost,
        embedPolicy: OrganizationSocialEmbedPolicy
    ) throws -> OrganizationSocialPost {
        guard
            let id = UUID(uuidString: payload.id),
            let rawPermalink = URL(string: payload.permalink)
        else {
            throw OrganizationAssetError.invalidResponse
        }
        let canonical = try InstagramPermalink(
            payload.permalink
        ).url
        guard canonical == rawPermalink else {
            throw OrganizationAssetError.invalidResponse
        }

        let attribution = payload.attribution
        if let attribution {
            let trimmed = attribution.trimmingCharacters(
                in: .whitespacesAndNewlines
            )
            guard
                !trimmed.isEmpty,
                trimmed == attribution,
                attribution.count <= 200
            else {
                throw OrganizationAssetError.invalidResponse
            }
        }
        guard payload.revision >= 0 else {
            throw OrganizationAssetError.invalidResponse
        }

        switch payload.renderMode {
        case .link:
            guard payload.embedUrl == nil else {
                throw OrganizationAssetError.invalidResponse
            }
            return OrganizationSocialPost(
                id: id,
                permalink: canonical,
                renderMode: .link,
                embedURL: nil,
                attribution: attribution,
                revision: payload.revision
            )
        case .embed:
            guard
                let rawEmbedURL = payload.embedUrl,
                let embedURL = URL(string: rawEmbedURL)
            else {
                throw OrganizationAssetError.invalidResponse
            }
            let candidate = OrganizationSocialPost(
                id: id,
                permalink: canonical,
                renderMode: .embed,
                embedURL: embedURL,
                attribution: attribution,
                revision: payload.revision
            )
            if embedPolicy.validatedEmbedURL(for: candidate) == embedURL {
                return candidate
            }
            return OrganizationSocialPost(
                id: id,
                permalink: canonical,
                renderMode: .link,
                embedURL: nil,
                attribution: attribution,
                revision: payload.revision
            )
        }
    }

    fileprivate static func forbiddenError(code: String) -> OrganizationAssetError {
        code == "brown_membership_required"
            ? .brownMembershipRequired
            : .authorityRequired
    }

    fileprivate static func error(status: Int) -> OrganizationAssetError {
        switch status {
        case 400:
            return .invalidResponse
        case 401:
            return .authenticationRequired
        case 403:
            return .authorityRequired
        case 404:
            return .notFound
        case 409:
            return .conflict
        case 429:
            return .quotaExceeded
        case 503:
            return .unavailable
        default:
            return .invalidResponse
        }
    }

    fileprivate static func normalizedClientError(
        _ error: any Error
    ) -> any Error {
        if error is CancellationError {
            return CancellationError()
        }
        if let error = error as? OrganizationAssetError {
            return error
        }
        var underlying: any Error = error
        while let clientError = underlying as? ClientError {
            underlying = clientError.underlyingError
        }
        if underlying is CancellationError {
            return CancellationError()
        }
        if underlying is DecodingError {
            return OrganizationAssetError.invalidResponse
        }
        if underlying is URLError {
            return OrganizationAssetError.unavailable
        }
        return OrganizationAssetError.invalidResponse
    }

    fileprivate static func safeOutcome(for error: any Error) -> SafeOutcome {
        if error is CancellationError {
            return .cancelled
        }
        switch error as? OrganizationAssetError {
        case .conflict:
            return .conflict
        case .unavailable:
            return .unavailable
        case .none:
            return .unavailable
        default:
            return .rejected
        }
    }
}
