import BrownSyncAPI
import Foundation
import OpenAPIRuntime

protocol OrganizationMediaRepository: Sendable {
    func media(
        organizationID: String,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<OrganizationMediaCollection>

    func reserveUpload(
        organizationID: String,
        command: OrganizationMediaReservationCommand
    ) async throws -> OrganizationMediaReservation

    func uploadReserved(
        _ reservation: OrganizationMediaReservation,
        prepared: PreparedOrganizationImage
    ) async throws -> OrganizationMediaUploadResult

    func deleteMedia(
        organizationID: String,
        mediaID: UUID,
        expectedRevision: Int
    ) async throws -> OrganizationMediaMutationResult

    func reorderGallery(
        organizationID: String,
        mediaIDs: [UUID],
        expectedGalleryRevision: Int
    ) async throws -> OrganizationGalleryReorderResult
}

struct WorkerOrganizationMediaRepository:
    OrganizationMediaRepository,
    Sendable
{
    private let publicClient: BrownSyncAPI.Client
    private let protectedClient: BrownSyncAPI.Client
    private let cache: PublicResponseCache
    private let protectedStore: any OrganizationMediaProtectedStore
    private let logger: any OrganizationAssetLogSink
    private let nowProvider: @Sendable () -> Date

    init(
        publicClient: BrownSyncAPI.Client,
        protectedClient: BrownSyncAPI.Client,
        cache: PublicResponseCache,
        protectedStore: any OrganizationMediaProtectedStore,
        logger: any OrganizationAssetLogSink =
            NullOrganizationAssetLogSink(),
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.publicClient = publicClient
        self.protectedClient = protectedClient
        self.cache = cache
        self.protectedStore = protectedStore
        self.logger = logger
        nowProvider = now
    }

    func media(
        organizationID: String,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<OrganizationMediaCollection> {
        guard !organizationID.isEmpty else {
            throw OrganizationAssetError.invalidResponse
        }
        let resource: PublicResource<OrganizationMediaCollection>
        do {
            resource = try await loadPublicResource(
                cache: cache,
                key: Self.publicCacheKey(organizationID),
                ttl: 5 * 60,
                policy: policy,
                now: nowProvider
            ) { [publicClient] in
                do {
                    let output =
                        try await publicClient
                        .getOrganizationMedia(
                            .init(path: .init(id: organizationID))
                        )
                    return try Self.mediaCollection(
                        from: output,
                        expectedOrganizationID: organizationID
                    )
                } catch {
                    throw Self.normalizedClientError(error)
                }
            }
        } catch {
            throw Self.normalizedClientError(error)
        }
        await logger.record(.publicMediaLoaded(source: resource.source))
        return resource
    }

    func reserveUpload(
        organizationID: String,
        command: OrganizationMediaReservationCommand
    ) async throws -> OrganizationMediaReservation {
        try command.validate()
        guard !organizationID.isEmpty else {
            throw OrganizationAssetError.invalidResponse
        }
        return try await runMutation(.mediaReservation) {
            [protectedClient] in
            let request =
                Components.Schemas.OrgMediaUploadReservationRequest(
                    clientRequestId:
                        command.clientRequestID.uuidString.lowercased(),
                    kind: Self.generatedKind(command.kind),
                    altText: command.altText,
                    expectedOrganizationRevision:
                        command.expectedOrganizationRevision,
                    expectedGalleryRevision:
                        command.expectedGalleryRevision
                )
            let output =
                try await protectedClient
                .reserveOrganizationMediaUpload(
                    .init(
                        path: .init(id: organizationID),
                        body: .json(request)
                    )
                )
            switch output {
            case .created(let response):
                switch response.body {
                case .json(let payload):
                    guard
                        let uploadID = UUID(uuidString: payload.uploadId),
                        Self.kind(payload.kind) == command.kind
                    else {
                        throw OrganizationAssetError.invalidResponse
                    }
                    return OrganizationMediaReservation(
                        organizationID: organizationID,
                        uploadID: uploadID,
                        kind: command.kind,
                        expiresAt: payload.expiresAt,
                        replayed: payload.replayed
                    )
                }
            case .badRequest:
                throw OrganizationAssetError.invalidAltText
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

    func uploadReserved(
        _ reservation: OrganizationMediaReservation,
        prepared: PreparedOrganizationImage
    ) async throws -> OrganizationMediaUploadResult {
        try reservation.validate()
        guard reservation.expiresAt > nowProvider() else {
            await protectedStore.purge(
                prepared.handle,
                reason: .expired
            )
            throw OrganizationAssetError.reservationExpired
        }
        guard
            prepared.byteCount > 0,
            prepared.byteCount <= 8_388_608
        else {
            throw OrganizationAssetError.payloadTooLarge
        }

        return try await runMutation(
            .mediaUpload,
            invalidatingPublicKey:
                Self.publicCacheKey(reservation.organizationID)
        ) {
            let body = try await protectedStore.body(for: prepared)
            let generatedBody: Operations.UploadOrganizationMedia.Input.Body
            switch prepared.contentType {
            case .jpeg:
                generatedBody = .jpeg(body)
            case .png:
                generatedBody = .png(body)
            case .webP:
                generatedBody = .imageWebp(body)
            }

            let output =
                try await protectedClient
                .uploadOrganizationMedia(
                    .init(
                        path: .init(
                            uploadId:
                                reservation.uploadID.uuidString.lowercased()
                        ),
                        body: generatedBody
                    )
                )
            switch output {
            case .created(let response):
                switch response.body {
                case .json(let payload):
                    let result = try Self.uploadResult(from: payload)
                    guard result.asset.kind == reservation.kind else {
                        throw OrganizationAssetError.invalidResponse
                    }
                    try result.validate()
                    return result
                }
            case .badRequest:
                throw OrganizationAssetError.invalidMedia
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
            case .contentTooLarge:
                throw OrganizationAssetError.payloadTooLarge
            case .unsupportedMediaType:
                throw OrganizationAssetError.unsupportedMedia
            case .unprocessableContent:
                throw OrganizationAssetError.invalidMedia
            case .tooManyRequests:
                throw OrganizationAssetError.quotaExceeded
            case .serviceUnavailable:
                throw OrganizationAssetError.unavailable
            case .undocumented(let statusCode, _):
                throw Self.error(status: statusCode)
            }
        }
    }

    func deleteMedia(
        organizationID: String,
        mediaID: UUID,
        expectedRevision: Int
    ) async throws -> OrganizationMediaMutationResult {
        guard !organizationID.isEmpty, expectedRevision >= 0 else {
            throw OrganizationAssetError.invalidResponse
        }
        return try await runMutation(
            .mediaDelete,
            invalidatingPublicKey: Self.publicCacheKey(organizationID)
        ) {
            [protectedClient] in
            let output =
                try await protectedClient
                .deleteOrganizationMedia(
                    .init(
                        path: .init(
                            id: organizationID,
                            mediaId: mediaID.uuidString.lowercased()
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
                    let result = try Self.mutationResult(
                        from: payload
                    )
                    guard result.mediaID == mediaID else {
                        throw OrganizationAssetError.invalidResponse
                    }
                    try result.validate()
                    return result
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

    func reorderGallery(
        organizationID: String,
        mediaIDs: [UUID],
        expectedGalleryRevision: Int
    ) async throws -> OrganizationGalleryReorderResult {
        guard
            !organizationID.isEmpty,
            expectedGalleryRevision >= 0,
            mediaIDs.count <= 12,
            Set(mediaIDs).count == mediaIDs.count
        else {
            throw OrganizationAssetError.invalidGalleryOrder
        }
        return try await runMutation(
            .galleryReorder,
            invalidatingPublicKey: Self.publicCacheKey(organizationID)
        ) {
            [protectedClient] in
            let output =
                try await protectedClient
                .reorderOrganizationGallery(
                    .init(
                        path: .init(id: organizationID),
                        body: .json(
                            .init(
                                expectedGalleryRevision:
                                    expectedGalleryRevision,
                                mediaIds: mediaIDs.map {
                                    $0.uuidString.lowercased()
                                }
                            )
                        )
                    )
                )
            switch output {
            case .ok(let response):
                switch response.body {
                case .json(let payload):
                    guard payload.galleryRevision >= 0 else {
                        throw OrganizationAssetError.invalidResponse
                    }
                    return OrganizationGalleryReorderResult(
                        galleryRevision: payload.galleryRevision,
                        changed: payload.changed
                    )
                }
            case .badRequest:
                throw OrganizationAssetError.invalidGalleryOrder
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
        "organization-media:v1:\(organizationID)"
    }
}

extension WorkerOrganizationMediaRepository {
    fileprivate static func mediaCollection(
        from output: Operations.GetOrganizationMedia.Output,
        expectedOrganizationID: String
    ) throws -> OrganizationMediaCollection {
        switch output {
        case .ok(let response):
            switch response.body {
            case .json(let payload):
                guard payload.organizationId == expectedOrganizationID else {
                    throw OrganizationAssetError.invalidResponse
                }
                let collection = OrganizationMediaCollection(
                    organizationID: payload.organizationId,
                    organizationRevision:
                        payload.organizationRevision,
                    galleryRevision: payload.galleryRevision,
                    avatar: try payload.avatar.map {
                        try asset(from: $0, expectedKind: .avatar)
                    },
                    banner: try payload.banner.map {
                        try asset(from: $0, expectedKind: .banner)
                    },
                    gallery: try payload.gallery.map {
                        try asset(from: $0)
                    }
                )
                try collection.validate()
                return collection
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

    fileprivate static func asset(
        from payload: Components.Schemas.OrgMediaAsset
    ) throws -> OrganizationMediaAsset {
        guard
            let id = UUID(uuidString: payload.id),
            let url = URL(string: payload.url)
        else {
            throw OrganizationAssetError.invalidResponse
        }
        let asset = OrganizationMediaAsset(
            id: id,
            kind: kind(payload.kind),
            url: url,
            width: payload.width,
            height: payload.height,
            byteSize: payload.byteSize,
            altText: payload.altText,
            position: payload.position,
            revision: payload.revision
        )
        try asset.validate()
        return asset
    }

    fileprivate static func asset(
        from payload: Components.Schemas.NullableOrgMediaAsset,
        expectedKind: OrganizationMediaKind
    ) throws -> OrganizationMediaAsset {
        guard
            let id = UUID(uuidString: payload.id),
            let url = URL(string: payload.url)
        else {
            throw OrganizationAssetError.invalidResponse
        }
        let asset = OrganizationMediaAsset(
            id: id,
            kind: kind(payload.kind),
            url: url,
            width: payload.width,
            height: payload.height,
            byteSize: payload.byteSize,
            altText: payload.altText,
            position: payload.position,
            revision: payload.revision
        )
        try asset.validate()
        guard asset.kind == expectedKind else {
            throw OrganizationAssetError.invalidResponse
        }
        return asset
    }

    fileprivate static func uploadResult(
        from payload: Components.Schemas.OrgMediaUploadResult
    ) throws -> OrganizationMediaUploadResult {
        OrganizationMediaUploadResult(
            asset: try asset(from: payload.asset),
            organizationRevision: payload.organizationRevision,
            galleryRevision: payload.galleryRevision
        )
    }

    fileprivate static func mutationResult(
        from payload: Components.Schemas.OrgMediaMutationResult
    ) throws -> OrganizationMediaMutationResult {
        guard let mediaID = UUID(uuidString: payload.mediaId) else {
            throw OrganizationAssetError.invalidResponse
        }
        return OrganizationMediaMutationResult(
            mediaID: mediaID,
            kind: kind(payload.kind),
            organizationRevision: payload.organizationRevision,
            galleryRevision: payload.galleryRevision,
            changed: payload.changed
        )
    }

    fileprivate static func generatedKind(
        _ kind: OrganizationMediaKind
    ) -> Components.Schemas.OrgMediaKind {
        switch kind {
        case .avatar:
            return .avatar
        case .banner:
            return .banner
        case .gallery:
            return .gallery
        }
    }

    fileprivate static func kind(
        _ kind: Components.Schemas.OrgMediaKind
    ) -> OrganizationMediaKind {
        switch kind {
        case .avatar:
            return .avatar
        case .banner:
            return .banner
        case .gallery:
            return .gallery
        }
    }

    fileprivate static func forbiddenError(
        code: String
    ) -> OrganizationAssetError {
        return code == "brown_membership_required"
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
        case 413:
            return .payloadTooLarge
        case 415:
            return .unsupportedMedia
        case 422:
            return .invalidMedia
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
