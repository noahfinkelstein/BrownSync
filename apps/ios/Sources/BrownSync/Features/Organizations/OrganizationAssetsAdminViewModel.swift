import Combine
import Foundation

struct OrganizationAssetUploadOperation: Equatable, Sendable {
    fileprivate let operationID: UInt64
    fileprivate let stateGeneration: UInt64
    let kind: OrganizationMediaKind
}

@MainActor
final class OrganizationAssetsAdminViewModel: ObservableObject {
    private struct MutationOperation {
        let operationID: UInt64
        let stateGeneration: UInt64
    }

    @Published private(set) var access: OrganizationAdminAccess
    @Published private(set) var media: OrganizationMediaCollection
    @Published private(set) var socialPosts: OrganizationSocialPostCollection
    @Published private(set) var lastError: OrganizationAssetError?
    @Published private(set) var isMutating = false

    let organizationID: String

    private let mediaRepository: any OrganizationMediaRepository
    private let socialRepository: any OrganizationSocialPostRepository
    private let submissionFactory: OrganizationAssetSubmissionFactory
    private var pendingSocialAdd: OrganizationSocialPostSubmission?
    private var stateGeneration: UInt64 = 0
    private var nextMutationID: UInt64 = 0
    private var activeMutationID: UInt64?

    init(
        organizationID: String,
        access: OrganizationAdminAccess,
        media: OrganizationMediaCollection,
        socialPosts: OrganizationSocialPostCollection,
        mediaRepository: any OrganizationMediaRepository,
        socialRepository: any OrganizationSocialPostRepository,
        submissionFactory: OrganizationAssetSubmissionFactory =
            OrganizationAssetSubmissionFactory(
                uuids: SystemUUIDProvider()
            )
    ) {
        self.organizationID = organizationID
        self.access = access
        self.media = media
        self.socialPosts = socialPosts
        self.mediaRepository = mediaRepository
        self.socialRepository = socialRepository
        self.submissionFactory = submissionFactory
    }

    var canAddSocialPost: Bool {
        guard requireMutationAccess() else { return false }
        guard socialPosts.posts.count < 12 else {
            lastError = .collectionLimitReached
            return false
        }
        lastError = nil
        return true
    }

    func canBeginUpload(kind: OrganizationMediaKind) -> Bool {
        guard requireMutationAccess() else { return false }
        if kind == .gallery, media.gallery.count >= 12 {
            lastError = .collectionLimitReached
            return false
        }
        lastError = nil
        return true
    }

    func updateAccess(_ access: OrganizationAdminAccess) {
        stateGeneration &+= 1
        self.access = access
        if access != .admittedAdmin {
            pendingSocialAdd = nil
        }
    }

    func replacePublicState(
        media: OrganizationMediaCollection,
        socialPosts: OrganizationSocialPostCollection
    ) {
        stateGeneration &+= 1
        self.media = media
        self.socialPosts = socialPosts
        lastError = nil
    }

    func deleteMedia(id: UUID) async {
        guard requireMutationAccess() else { return }
        guard let asset = asset(id: id) else {
            lastError = .notFound
            return
        }

        let snapshot = media
        let expectedRevision: Int
        switch asset.kind {
        case .avatar, .banner:
            expectedRevision = snapshot.organizationRevision
        case .gallery:
            expectedRevision = snapshot.galleryRevision
        }
        guard let generation = beginMutation() else {
            return
        }
        media = snapshot.removing(asset)
        defer { finishMutation(generation) }

        do {
            let result = try await mediaRepository.deleteMedia(
                organizationID: organizationID,
                mediaID: id,
                expectedRevision: expectedRevision
            )
            try result.validate()
            guard
                result.mediaID == id,
                result.kind == asset.kind
            else {
                throw OrganizationAssetError.invalidResponse
            }
            guard mutationIsCurrent(generation) else {
                return
            }
            media = media.applying(result)
            lastError = nil
        } catch {
            guard mutationIsCurrent(generation) else {
                return
            }
            media = snapshot
            if error is CancellationError {
                lastError = nil
                return
            }
            let normalized = Self.assetError(error)
            lastError = normalized
            applyAuthoritativeAccessError(normalized)
            if normalized == .conflict {
                await reloadMediaAfterConflict(generation: generation)
                if mutationIsCurrent(generation) {
                    lastError = .conflict
                }
            }
        }
    }

    func reorderGallery(mediaIDs: [UUID]) async {
        guard requireMutationAccess() else { return }
        let currentIDs = media.gallery.map(\.id)
        guard
            mediaIDs.count <= 12,
            mediaIDs.count == currentIDs.count,
            Set(mediaIDs).count == mediaIDs.count,
            Set(mediaIDs) == Set(currentIDs)
        else {
            lastError = .invalidGalleryOrder
            return
        }

        let snapshot = media
        guard let optimistic = snapshot.reorderingGallery(mediaIDs) else {
            lastError = .invalidGalleryOrder
            return
        }
        guard let generation = beginMutation() else {
            return
        }
        media = optimistic
        defer { finishMutation(generation) }

        do {
            let result = try await mediaRepository.reorderGallery(
                organizationID: organizationID,
                mediaIDs: mediaIDs,
                expectedGalleryRevision: snapshot.galleryRevision
            )
            guard result.galleryRevision >= 0 else {
                throw OrganizationAssetError.invalidResponse
            }
            guard mutationIsCurrent(generation) else {
                return
            }
            media = media.withGalleryRevision(
                result.galleryRevision
            )
            lastError = nil
        } catch {
            guard mutationIsCurrent(generation) else {
                return
            }
            media = snapshot
            if error is CancellationError {
                lastError = nil
                return
            }
            let normalized = Self.assetError(error)
            lastError = normalized
            applyAuthoritativeAccessError(normalized)
            if normalized == .conflict {
                await reloadMediaAfterConflict(generation: generation)
                if mutationIsCurrent(generation) {
                    lastError = .conflict
                }
            }
        }
    }

    func addSocialPost(permalink: URL) async {
        guard canAddSocialPost else { return }
        let canonical: URL
        do {
            canonical = try InstagramPermalink(
                permalink.absoluteString
            ).url
        } catch {
            lastError = .unsafeURL
            return
        }
        guard let generation = beginMutation() else {
            return
        }
        defer { finishMutation(generation) }
        let submission = await submissionFactory.socialSubmission(
            permalink: canonical
        )
        guard mutationIsCurrent(generation) else {
            return
        }
        pendingSocialAdd = submission
        await submitSocialPost(
            submission,
            generation: generation
        )
    }

    func replayPendingSocialPostAdd() async {
        guard
            canAddSocialPost,
            let submission = pendingSocialAdd,
            let generation = beginMutation()
        else {
            return
        }
        defer { finishMutation(generation) }
        await submitSocialPost(
            submission,
            generation: generation
        )
    }

    private func submitSocialPost(
        _ submission: OrganizationSocialPostSubmission,
        generation: MutationOperation
    ) async {
        do {
            let result = try await socialRepository.add(
                organizationID: organizationID,
                clientRequestID: submission.clientRequestID,
                permalink: submission.permalink
            )
            try result.post.validate()
            var posts = socialPosts.posts.filter {
                $0.id != result.post.id
            }
            posts.append(result.post)
            guard posts.count <= 12 else {
                throw OrganizationAssetError.invalidResponse
            }
            let candidate = OrganizationSocialPostCollection(
                organizationID: organizationID,
                posts: posts
            )
            try candidate.validate()
            guard mutationIsCurrent(generation) else {
                return
            }
            socialPosts = candidate
            pendingSocialAdd = nil
            lastError = nil
        } catch {
            guard mutationIsCurrent(generation) else {
                return
            }
            if error is CancellationError {
                lastError = nil
                return
            }
            let normalized = Self.assetError(error)
            lastError = normalized
            applyAuthoritativeAccessError(normalized)
            if access != .admittedAdmin {
                pendingSocialAdd = nil
            }
        }
    }

    func refreshSocialPost(id: UUID) async {
        guard requireMutationAccess() else { return }
        guard socialPosts.posts.contains(where: { $0.id == id }) else {
            lastError = .notFound
            return
        }

        guard let generation = beginMutation() else {
            return
        }
        defer { finishMutation(generation) }
        do {
            let result = try await socialRepository.refresh(
                organizationID: organizationID,
                postID: id
            )
            try result.post.validate()
            guard result.post.id == id else {
                throw OrganizationAssetError.invalidResponse
            }
            let candidate = socialPosts.replacing(result.post)
            try candidate.validate()
            guard mutationIsCurrent(generation) else {
                return
            }
            socialPosts = candidate
            lastError = nil
        } catch {
            guard mutationIsCurrent(generation) else {
                return
            }
            if error is CancellationError {
                lastError = nil
                return
            }
            let normalized = Self.assetError(error)
            lastError = normalized
            applyAuthoritativeAccessError(normalized)
        }
    }

    func deleteSocialPost(id: UUID) async {
        guard requireMutationAccess() else { return }
        guard
            let post = socialPosts.posts.first(
                where: { $0.id == id }
            )
        else {
            lastError = .notFound
            return
        }

        let snapshot = socialPosts
        guard let generation = beginMutation() else {
            return
        }
        socialPosts = OrganizationSocialPostCollection(
            organizationID: snapshot.organizationID,
            posts: snapshot.posts.filter { $0.id != id }
        )
        defer { finishMutation(generation) }

        do {
            let result = try await socialRepository.delete(
                organizationID: organizationID,
                postID: id,
                expectedRevision: post.revision
            )
            guard
                result.postID == id,
                result.revision >= 0
            else {
                throw OrganizationAssetError.invalidResponse
            }
            guard mutationIsCurrent(generation) else {
                return
            }
            lastError = nil
        } catch {
            guard mutationIsCurrent(generation) else {
                return
            }
            socialPosts = snapshot
            if error is CancellationError {
                lastError = nil
                return
            }
            let normalized = Self.assetError(error)
            lastError = normalized
            applyAuthoritativeAccessError(normalized)
            if normalized == .conflict {
                await reloadSocialAfterConflict(
                    generation: generation
                )
                if mutationIsCurrent(generation) {
                    lastError = .conflict
                }
            }
        }
    }

    func beginUpload(
        kind: OrganizationMediaKind
    ) -> OrganizationAssetUploadOperation? {
        guard canBeginUpload(kind: kind) else { return nil }
        guard let mutation = beginMutation() else { return nil }
        return OrganizationAssetUploadOperation(
            operationID: mutation.operationID,
            stateGeneration: mutation.stateGeneration,
            kind: kind
        )
    }

    func cancelUpload(
        _ operation: OrganizationAssetUploadOperation
    ) {
        finishMutation(operationID: operation.operationID)
    }

    func applyUploadResult(
        _ result: OrganizationMediaUploadResult,
        operation: OrganizationAssetUploadOperation
    ) {
        defer {
            finishMutation(operationID: operation.operationID)
        }
        guard uploadIsCurrent(operation) else {
            return
        }
        do {
            try result.validate()
            guard result.asset.kind == operation.kind else {
                throw OrganizationAssetError.invalidResponse
            }
            let candidate = media.applying(result)
            try candidate.validate()
            stateGeneration &+= 1
            media = candidate
            lastError = nil
        } catch {
            lastError = .invalidResponse
        }
    }

    private func requireMutationAccess() -> Bool {
        do {
            try access.requireOrganizationAssetMutation()
            return true
        } catch let error as OrganizationAssetError {
            lastError = error
            return false
        } catch {
            lastError = .authorityRequired
            return false
        }
    }

    private func beginMutation() -> MutationOperation? {
        guard activeMutationID == nil else {
            return nil
        }
        nextMutationID &+= 1
        let operation = MutationOperation(
            operationID: nextMutationID,
            stateGeneration: stateGeneration
        )
        activeMutationID = operation.operationID
        isMutating = true
        return operation
    }

    private func mutationIsCurrent(
        _ operation: MutationOperation
    ) -> Bool {
        activeMutationID == operation.operationID
            && stateGeneration == operation.stateGeneration
            && access == .admittedAdmin
    }

    private func finishMutation(_ operation: MutationOperation) {
        finishMutation(operationID: operation.operationID)
    }

    private func finishMutation(operationID: UInt64) {
        guard activeMutationID == operationID else {
            return
        }
        activeMutationID = nil
        isMutating = false
    }

    private func uploadIsCurrent(
        _ operation: OrganizationAssetUploadOperation
    ) -> Bool {
        activeMutationID == operation.operationID
            && stateGeneration == operation.stateGeneration
            && access == .admittedAdmin
    }

    private func asset(id: UUID) -> OrganizationMediaAsset? {
        if media.avatar?.id == id {
            return media.avatar
        }
        if media.banner?.id == id {
            return media.banner
        }
        return media.gallery.first { $0.id == id }
    }

    private func applyAuthoritativeAccessError(
        _ error: OrganizationAssetError
    ) {
        switch error {
        case .authenticationRequired, .brownMembershipRequired:
            access = .signedOut
        case .authorityRequired:
            access = .admittedNonAdmin
        default:
            break
        }
    }

    private func reloadMediaAfterConflict(
        generation: MutationOperation
    ) async {
        do {
            let reloaded = try await mediaRepository.media(
                organizationID: organizationID,
                policy: .reload
            ).value
            guard mutationIsCurrent(generation) else {
                return
            }
            media = reloaded
        } catch {
            // Preserve the pre-mutation snapshot and the conflict signal.
        }
    }

    private func reloadSocialAfterConflict(
        generation: MutationOperation
    ) async {
        do {
            let reloaded = try await socialRepository.posts(
                organizationID: organizationID,
                policy: .reload
            ).value
            guard mutationIsCurrent(generation) else {
                return
            }
            socialPosts = reloaded
        } catch {
            // Preserve the pre-mutation snapshot and the conflict signal.
        }
    }

    private static func assetError(
        _ error: any Error
    ) -> OrganizationAssetError {
        if let error = error as? OrganizationAssetError {
            return error
        }
        return .unavailable
    }
}

extension OrganizationMediaCollection {
    fileprivate func removing(
        _ asset: OrganizationMediaAsset
    ) -> OrganizationMediaCollection {
        switch asset.kind {
        case .avatar:
            return OrganizationMediaCollection(
                organizationID: organizationID,
                organizationRevision: organizationRevision,
                galleryRevision: galleryRevision,
                avatar: nil,
                banner: banner,
                gallery: gallery
            )
        case .banner:
            return OrganizationMediaCollection(
                organizationID: organizationID,
                organizationRevision: organizationRevision,
                galleryRevision: galleryRevision,
                avatar: avatar,
                banner: nil,
                gallery: gallery
            )
        case .gallery:
            return OrganizationMediaCollection(
                organizationID: organizationID,
                organizationRevision: organizationRevision,
                galleryRevision: galleryRevision,
                avatar: avatar,
                banner: banner,
                gallery:
                    gallery
                    .filter { $0.id != asset.id }
                    .enumerated()
                    .map { index, value in
                        value.withPosition(index)
                    }
            )
        }
    }

    fileprivate func reorderingGallery(
        _ ids: [UUID]
    ) -> OrganizationMediaCollection? {
        let byID = Dictionary(
            uniqueKeysWithValues: gallery.map { ($0.id, $0) }
        )
        let reordered = ids.enumerated().compactMap { index, id in
            byID[id]?.withPosition(index)
        }
        guard reordered.count == ids.count else { return nil }
        return OrganizationMediaCollection(
            organizationID: organizationID,
            organizationRevision: organizationRevision,
            galleryRevision: galleryRevision,
            avatar: avatar,
            banner: banner,
            gallery: reordered
        )
    }

    fileprivate func applying(
        _ result: OrganizationMediaMutationResult
    ) -> OrganizationMediaCollection {
        OrganizationMediaCollection(
            organizationID: organizationID,
            organizationRevision:
                result.organizationRevision
                ?? organizationRevision,
            galleryRevision:
                result.galleryRevision
                ?? galleryRevision,
            avatar: avatar,
            banner: banner,
            gallery: gallery
        )
    }

    fileprivate func applying(
        _ result: OrganizationMediaUploadResult
    ) -> OrganizationMediaCollection {
        let nextAvatar =
            result.asset.kind == .avatar
            ? result.asset
            : avatar
        let nextBanner =
            result.asset.kind == .banner
            ? result.asset
            : banner
        var nextGallery = gallery
        if result.asset.kind == .gallery {
            nextGallery.removeAll { $0.id == result.asset.id }
            nextGallery.append(result.asset)
            nextGallery.sort {
                ($0.position ?? .max) < ($1.position ?? .max)
            }
        }
        return OrganizationMediaCollection(
            organizationID: organizationID,
            organizationRevision:
                result.organizationRevision
                ?? organizationRevision,
            galleryRevision:
                result.galleryRevision
                ?? galleryRevision,
            avatar: nextAvatar,
            banner: nextBanner,
            gallery: nextGallery
        )
    }

    fileprivate func withGalleryRevision(
        _ revision: Int
    ) -> OrganizationMediaCollection {
        OrganizationMediaCollection(
            organizationID: organizationID,
            organizationRevision: organizationRevision,
            galleryRevision: revision,
            avatar: avatar,
            banner: banner,
            gallery: gallery
        )
    }
}

extension OrganizationMediaAsset {
    fileprivate func withPosition(_ position: Int) -> OrganizationMediaAsset {
        OrganizationMediaAsset(
            id: id,
            kind: kind,
            url: url,
            width: width,
            height: height,
            byteSize: byteSize,
            altText: altText,
            position: position,
            revision: revision
        )
    }
}

extension OrganizationSocialPostCollection {
    fileprivate func replacing(
        _ replacement: OrganizationSocialPost
    ) -> OrganizationSocialPostCollection {
        OrganizationSocialPostCollection(
            organizationID: organizationID,
            posts: posts.map {
                $0.id == replacement.id ? replacement : $0
            }
        )
    }
}
