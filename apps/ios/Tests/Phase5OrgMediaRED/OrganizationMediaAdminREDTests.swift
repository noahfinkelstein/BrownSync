import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class OrganizationMediaAdminREDTests: XCTestCase {
    func testDeniedAccessMakesZeroMediaMutationCalls() async {
        let denied: [OrganizationAdminAccess] = [
            .signedOut,
            .authenticating,
            .admittedNonAdmin,
        ]

        for access in denied {
            let repository = Phase5OrgMediaRepositoryFake()
            let viewModel = makeViewModel(
                access: access,
                repository: repository
            )

            await viewModel.deleteMedia(
                id: Phase5OrgMediaFixture.galleryID
            )
            await viewModel.reorderGallery(
                mediaIDs: [
                    Phase5OrgMediaFixture.secondGalleryID,
                    Phase5OrgMediaFixture.galleryID,
                ]
            )

            let recordedCalls = await repository.recordedCalls()
            XCTAssertTrue(recordedCalls.isEmpty)
            XCTAssertNotNil(viewModel.lastError)
        }
    }

    func testGalleryDeleteIsOptimisticUsesGalleryRevisionAndRestores()
        async
    {
        let repository = Phase5ControlledMediaRepository()
        let viewModel = makeViewModel(repository: repository)

        let mutation = Task {
            await viewModel.deleteMedia(
                id: Phase5OrgMediaFixture.galleryID
            )
        }
        await repository.waitForDeleteStart()

        XCTAssertEqual(
            viewModel.media.gallery.map(\.id),
            [Phase5OrgMediaFixture.secondGalleryID]
        )
        XCTAssertEqual(
            viewModel.media.gallery.map(\.position),
            [0]
        )
        await repository.finishDelete(
            failure: .unavailable
        )
        await mutation.value

        XCTAssertEqual(
            viewModel.media,
            Phase5OrgMediaFixture.collection()
        )
        XCTAssertEqual(viewModel.lastError, .unavailable)
        let recordedCalls = await repository.recordedCalls()
        XCTAssertEqual(
            recordedCalls,
            [
                .delete(
                    Phase5OrgMediaFixture.organizationID,
                    Phase5OrgMediaFixture.galleryID,
                    7
                )
            ]
        )
    }

    func testDeleteConflictRestoresThenReloadsWithoutMutationRetry()
        async
    {
        let current = Phase5OrgMediaFixture.collection(
            galleryRevision: 11,
            gallery: [
                Phase5OrgMediaFixture.asset(
                    id: Phase5OrgMediaFixture.secondGalleryID,
                    position: 0
                )
            ]
        )
        let repository = Phase5ControlledMediaRepository(
            reloadValue: current
        )
        let viewModel = makeViewModel(repository: repository)

        let mutation = Task {
            await viewModel.deleteMedia(
                id: Phase5OrgMediaFixture.galleryID
            )
        }
        await repository.waitForDeleteStart()
        await repository.finishDelete(failure: .conflict)
        await mutation.value

        XCTAssertEqual(viewModel.media, current)
        XCTAssertEqual(viewModel.lastError, .conflict)
        let recordedCalls = await repository.recordedCalls()
        XCTAssertEqual(
            recordedCalls,
            [
                .delete(
                    Phase5OrgMediaFixture.organizationID,
                    Phase5OrgMediaFixture.galleryID,
                    7
                ),
                .media(
                    Phase5OrgMediaFixture.organizationID,
                    .reload
                ),
            ]
        )
    }

    func testAvatarDeleteUsesOrganizationRevisionNotAssetRevision()
        async
    {
        let repository = Phase5OrgMediaRepositoryFake()
        await repository.setDeleteResult(
            Phase5OrgMediaFixture.deleteResult(kind: .avatar)
        )
        let viewModel = makeViewModel(repository: repository)

        await viewModel.deleteMedia(
            id: Phase5OrgMediaFixture.avatarID
        )

        XCTAssertNil(viewModel.media.avatar)
        XCTAssertEqual(viewModel.media.organizationRevision, 5)
        let recordedCalls = await repository.recordedCalls()
        XCTAssertEqual(
            recordedCalls,
            [
                .delete(
                    Phase5OrgMediaFixture.organizationID,
                    Phase5OrgMediaFixture.avatarID,
                    4
                )
            ]
        )
    }

    func testReorderRejectsPartialDuplicateUnknownAndOverTwelveLists()
        async
    {
        let repository = Phase5OrgMediaRepositoryFake()
        let viewModel = makeViewModel(repository: repository)
        let invalidLists: [[UUID]] = [
            [Phase5OrgMediaFixture.galleryID],
            [
                Phase5OrgMediaFixture.galleryID,
                Phase5OrgMediaFixture.galleryID,
            ],
            [
                Phase5OrgMediaFixture.galleryID,
                UUID(),
            ],
            (0..<13).map { _ in UUID() },
        ]

        for ids in invalidLists {
            await viewModel.reorderGallery(mediaIDs: ids)
            XCTAssertEqual(
                viewModel.lastError,
                .invalidGalleryOrder
            )
        }

        let recordedCalls = await repository.recordedCalls()
        XCTAssertTrue(recordedCalls.isEmpty)
        XCTAssertEqual(
            viewModel.media,
            Phase5OrgMediaFixture.collection()
        )
    }

    func testReorderIsOptimisticAndSubmitsCompleteOrderOnce()
        async
    {
        let repository = Phase5ControlledMediaRepository()
        let viewModel = makeViewModel(repository: repository)
        let reversed = [
            Phase5OrgMediaFixture.secondGalleryID,
            Phase5OrgMediaFixture.galleryID,
        ]

        let mutation = Task {
            await viewModel.reorderGallery(mediaIDs: reversed)
        }
        await repository.waitForReorderStart()

        XCTAssertEqual(viewModel.media.gallery.map(\.id), reversed)
        XCTAssertEqual(
            viewModel.media.gallery.map(\.position),
            [0, 1]
        )
        await repository.finishReorder(
            result: OrganizationGalleryReorderResult(
                galleryRevision: 8,
                changed: true
            )
        )
        await mutation.value

        XCTAssertEqual(viewModel.media.galleryRevision, 8)
        let recordedCalls = await repository.recordedCalls()
        XCTAssertEqual(
            recordedCalls,
            [
                .reorder(
                    Phase5OrgMediaFixture.organizationID,
                    reversed,
                    7
                )
            ]
        )
    }

    func testThirteenthGalleryItemIsBlockedBeforeReservation()
        async
    {
        let repository = Phase5OrgMediaRepositoryFake()
        let fullGallery = (0..<12).map { index in
            Phase5OrgMediaFixture.asset(
                id: UUID(),
                position: index
            )
        }
        let viewModel = OrganizationAssetsAdminViewModel(
            organizationID: Phase5OrgMediaFixture.organizationID,
            access: .admittedAdmin,
            media: Phase5OrgMediaFixture.collection(
                gallery: fullGallery
            ),
            socialPosts:
                Phase5OrgMediaFixture.socialCollection(),
            mediaRepository: repository,
            socialRepository: Phase5OrgSocialRepositoryFake()
        )

        let allowed = viewModel.canBeginUpload(kind: .gallery)

        XCTAssertFalse(allowed)
        XCTAssertEqual(
            viewModel.lastError,
            .collectionLimitReached
        )
        let recordedCalls = await repository.recordedCalls()
        XCTAssertTrue(recordedCalls.isEmpty)
    }

    func testReplacementDoesNotReleaseLockBeforeRepositoryTaskFinishes()
        async
    {
        let repository = Phase5ControlledMediaRepository()
        let viewModel = makeViewModel(repository: repository)
        let delete = Task {
            await viewModel.deleteMedia(
                id: Phase5OrgMediaFixture.galleryID
            )
        }
        await repository.waitForDeleteStart()

        viewModel.replacePublicState(
            media: Phase5OrgMediaFixture.collection(),
            socialPosts: Phase5OrgMediaFixture.socialCollection()
        )
        await viewModel.deleteMedia(
            id: Phase5OrgMediaFixture.bannerID
        )

        let callsBeforeDeleteFinished = await repository.recordedCalls()
        await repository.finishDelete()
        await delete.value

        XCTAssertEqual(
            callsBeforeDeleteFinished,
            [
                .delete(
                    Phase5OrgMediaFixture.organizationID,
                    Phase5OrgMediaFixture.galleryID,
                    7
                )
            ]
        )
        XCTAssertFalse(viewModel.isMutating)
    }

    func testExternalPublicReplacementDefeatsStaleMutationCompletion()
        async
    {
        let replacement = Phase5OrgMediaFixture.collection(
            galleryRevision: 12,
            gallery: [
                Phase5OrgMediaFixture.asset(
                    id: Phase5OrgMediaFixture.secondGalleryID,
                    position: 0
                )
            ]
        )
        let repository = Phase5ControlledMediaRepository()
        let viewModel = makeViewModel(repository: repository)
        let delete = Task {
            await viewModel.deleteMedia(
                id: Phase5OrgMediaFixture.galleryID
            )
        }
        await repository.waitForDeleteStart()

        viewModel.replacePublicState(
            media: replacement,
            socialPosts: Phase5OrgMediaFixture.socialCollection()
        )
        await repository.finishDelete(failure: .unavailable)
        await delete.value

        XCTAssertEqual(viewModel.media, replacement)
        XCTAssertNil(viewModel.lastError)
        XCTAssertFalse(viewModel.isMutating)
    }

    func testUploadCandidateIsValidatedAsAWholeBeforePublication()
        throws
    {
        let viewModel = makeViewModel(
            repository: Phase5OrgMediaRepositoryFake()
        )
        let original = viewModel.media
        let duplicateCrossSlotID = OrganizationMediaUploadResult(
            asset: Phase5OrgMediaFixture.asset(
                id: Phase5OrgMediaFixture.avatarID,
                position: 2
            ),
            organizationRevision: nil,
            galleryRevision: 8
        )
        let operation = try XCTUnwrap(
            viewModel.beginUpload(kind: .gallery)
        )

        viewModel.applyUploadResult(
            duplicateCrossSlotID,
            operation: operation
        )

        XCTAssertEqual(viewModel.media, original)
        XCTAssertEqual(viewModel.lastError, .invalidResponse)
        XCTAssertFalse(viewModel.isMutating)
    }

    func testLateUploadResultCannotRepublishAfterAccessRevocation()
        throws
    {
        let viewModel = makeViewModel(
            repository: Phase5OrgMediaRepositoryFake()
        )
        let original = viewModel.media
        let operation = try XCTUnwrap(
            viewModel.beginUpload(kind: .gallery)
        )

        viewModel.updateAccess(.signedOut)
        viewModel.applyUploadResult(
            Phase5OrgMediaFixture.uploadResult(),
            operation: operation
        )

        XCTAssertEqual(viewModel.media, original)
        XCTAssertEqual(viewModel.access, .signedOut)
        XCTAssertFalse(viewModel.isMutating)
    }

    func testStaleUploadTokenCannotPublishOrUnlockCurrentOperation()
        throws
    {
        let viewModel = makeViewModel(
            repository: Phase5OrgMediaRepositoryFake()
        )
        let original = viewModel.media
        let stale = try XCTUnwrap(
            viewModel.beginUpload(kind: .gallery)
        )
        viewModel.cancelUpload(stale)
        let current = try XCTUnwrap(
            viewModel.beginUpload(kind: .gallery)
        )

        viewModel.applyUploadResult(
            Phase5OrgMediaFixture.uploadResult(),
            operation: stale
        )

        XCTAssertEqual(viewModel.media, original)
        XCTAssertTrue(viewModel.isMutating)
        viewModel.cancelUpload(current)
        XCTAssertFalse(viewModel.isMutating)
    }

    func testExplicitSocialReplayReusesPendingRequestIDInRealCalls()
        async
    {
        let social = Phase5OrgSocialRepositoryFake()
        await social.failNext(with: .unavailable)
        let uuids = Phase5OrgMediaUUIDSource([
            Phase5OrgMediaFixture.requestID,
            Phase5OrgMediaFixture.secondRequestID,
        ])
        let viewModel = OrganizationAssetsAdminViewModel(
            organizationID: Phase5OrgMediaFixture.organizationID,
            access: .admittedAdmin,
            media: Phase5OrgMediaFixture.collection(),
            socialPosts: Phase5OrgMediaFixture.socialCollection(posts: []),
            mediaRepository: Phase5OrgMediaRepositoryFake(),
            socialRepository: social,
            submissionFactory: OrganizationAssetSubmissionFactory(
                uuids: uuids
            )
        )

        await viewModel.addSocialPost(
            permalink: Phase5OrgMediaFixture.socialPost().permalink
        )
        await viewModel.replayPendingSocialPostAdd()

        let calls = await social.recordedCalls()
        let requestCount = await uuids.requestCount()
        XCTAssertEqual(
            calls,
            [
                .add(
                    Phase5OrgMediaFixture.organizationID,
                    Phase5OrgMediaFixture.requestID,
                    Phase5OrgMediaFixture.socialPost().permalink
                ),
                .add(
                    Phase5OrgMediaFixture.organizationID,
                    Phase5OrgMediaFixture.requestID,
                    Phase5OrgMediaFixture.socialPost().permalink
                ),
            ]
        )
        XCTAssertEqual(requestCount, 1)
        XCTAssertNil(viewModel.lastError)
    }

    private func makeViewModel(
        access: OrganizationAdminAccess = .admittedAdmin,
        repository: any OrganizationMediaRepository
    ) -> OrganizationAssetsAdminViewModel {
        OrganizationAssetsAdminViewModel(
            organizationID: Phase5OrgMediaFixture.organizationID,
            access: access,
            media: Phase5OrgMediaFixture.collection(),
            socialPosts: Phase5OrgMediaFixture.socialCollection(),
            mediaRepository: repository,
            socialRepository: Phase5OrgSocialRepositoryFake()
        )
    }
}

private actor Phase5ControlledMediaRepository:
    OrganizationMediaRepository
{
    typealias Call = Phase5OrgMediaRepositoryFake.Call

    private let reloadValue: OrganizationMediaCollection
    private var calls: [Call] = []
    private var deleteStarted = false
    private var deleteStartWaiters: [CheckedContinuation<Void, Never>] = []
    private var deleteContinuation:
        CheckedContinuation<
            OrganizationMediaMutationResult,
            Error
        >?
    private var reorderStarted = false
    private var reorderStartWaiters: [CheckedContinuation<Void, Never>] = []
    private var reorderContinuation:
        CheckedContinuation<
            OrganizationGalleryReorderResult,
            Error
        >?

    init(
        reloadValue: OrganizationMediaCollection =
            Phase5OrgMediaFixture.collection()
    ) {
        self.reloadValue = reloadValue
    }

    func recordedCalls() -> [Call] {
        calls
    }

    func waitForDeleteStart() async {
        if deleteStarted { return }
        await withCheckedContinuation { continuation in
            deleteStartWaiters.append(continuation)
        }
    }

    func finishDelete(
        result: OrganizationMediaMutationResult? = nil,
        failure: OrganizationAssetError? = nil
    ) {
        guard let continuation = deleteContinuation else {
            preconditionFailure("Delete has not started")
        }
        deleteContinuation = nil
        if let failure {
            continuation.resume(throwing: failure)
        } else {
            continuation.resume(
                returning: result
                    ?? Phase5OrgMediaFixture.deleteResult()
            )
        }
    }

    func waitForReorderStart() async {
        if reorderStarted { return }
        await withCheckedContinuation { continuation in
            reorderStartWaiters.append(continuation)
        }
    }

    func hasReorderStarted() -> Bool {
        reorderStarted
    }

    func finishReorder(
        result: OrganizationGalleryReorderResult? = nil,
        failure: OrganizationAssetError? = nil
    ) {
        guard let continuation = reorderContinuation else {
            preconditionFailure("Reorder has not started")
        }
        reorderContinuation = nil
        if let failure {
            continuation.resume(throwing: failure)
        } else {
            continuation.resume(
                returning: result
                    ?? OrganizationGalleryReorderResult(
                        galleryRevision: 8,
                        changed: true
                    )
            )
        }
    }

    func media(
        organizationID: String,
        policy: PublicLoadPolicy
    ) async throws -> PublicResource<OrganizationMediaCollection> {
        calls.append(.media(organizationID, policy))
        return PublicResource(
            value: reloadValue,
            source: .network
        )
    }

    func reserveUpload(
        organizationID _: String,
        command _: OrganizationMediaReservationCommand
    ) async throws -> OrganizationMediaReservation {
        throw Phase5OrgMediaTestFailure.unexpectedCall("reserve")
    }

    func uploadReserved(
        _: OrganizationMediaReservation,
        prepared _: PreparedOrganizationImage
    ) async throws -> OrganizationMediaUploadResult {
        throw Phase5OrgMediaTestFailure.unexpectedCall("upload")
    }

    func deleteMedia(
        organizationID: String,
        mediaID: UUID,
        expectedRevision: Int
    ) async throws -> OrganizationMediaMutationResult {
        calls.append(
            .delete(
                organizationID,
                mediaID,
                expectedRevision
            )
        )
        let deleteCallCount = calls.filter {
            if case .delete = $0 { true } else { false }
        }.count
        if deleteCallCount > 1 {
            return Phase5OrgMediaFixture.deleteResult(kind: .banner)
        }
        deleteStarted = true
        for waiter in deleteStartWaiters {
            waiter.resume()
        }
        deleteStartWaiters.removeAll()
        return try await withCheckedThrowingContinuation {
            continuation in
            deleteContinuation = continuation
        }
    }

    func reorderGallery(
        organizationID: String,
        mediaIDs: [UUID],
        expectedGalleryRevision: Int
    ) async throws -> OrganizationGalleryReorderResult {
        calls.append(
            .reorder(
                organizationID,
                mediaIDs,
                expectedGalleryRevision
            )
        )
        reorderStarted = true
        for waiter in reorderStartWaiters {
            waiter.resume()
        }
        reorderStartWaiters.removeAll()
        return try await withCheckedThrowingContinuation {
            continuation in
            reorderContinuation = continuation
        }
    }
}
