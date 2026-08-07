import Foundation

struct OrganizationMediaUploadSubmission:
    Equatable,
    Sendable,
    CustomStringConvertible,
    CustomDebugStringConvertible,
    CustomReflectable
{
    let clientRequestID: UUID
    let kind: OrganizationMediaKind
    let altText: String
    let prepared: PreparedOrganizationImage
    let expectedOrganizationRevision: Int?
    let expectedGalleryRevision: Int?

    var description: String {
        "<redacted organization media upload submission>"
    }

    var debugDescription: String {
        description
    }

    var customMirror: Mirror {
        Mirror(self, children: ["value": description])
    }
}

struct OrganizationSocialPostSubmission:
    Equatable,
    Sendable,
    CustomStringConvertible,
    CustomDebugStringConvertible,
    CustomReflectable
{
    let clientRequestID: UUID
    let permalink: URL

    var description: String {
        "<redacted organization social post submission>"
    }

    var debugDescription: String {
        description
    }

    var customMirror: Mirror {
        Mirror(self, children: ["value": description])
    }
}

struct OrganizationAssetSubmissionFactory: Sendable {
    private let uuids: any UUIDProviding

    init(uuids: any UUIDProviding) {
        self.uuids = uuids
    }

    func mediaSubmissionID() async -> UUID {
        await uuids.next()
    }

    func socialSubmission(
        permalink: URL
    ) async -> OrganizationSocialPostSubmission {
        OrganizationSocialPostSubmission(
            clientRequestID: await uuids.next(),
            permalink: permalink
        )
    }
}

actor OrganizationMediaUploadCoordinator:
    ProtectedTaskCancelling,
    ProtectedTaskActivating
{
    private typealias PreparationTask = Task<
        OrganizationMediaUploadSubmission,
        any Error
    >
    private typealias UploadTask = Task<
        OrganizationMediaUploadResult,
        any Error
    >

    private let repository: any OrganizationMediaRepository
    private let preparer: any OrganizationImagePreparing
    private let protectedStore: any OrganizationMediaProtectedStore
    private let submissionFactory: OrganizationAssetSubmissionFactory
    private let logger: any OrganizationAssetLogSink
    private let nowProvider: @Sendable () -> Date
    private var reservations: [UUID: OrganizationMediaReservation] = [:]
    private var activePreparations: [UUID: PreparationTask] = [:]
    private var activeUploads: [UUID: UploadTask] = [:]
    private var cancellationDepth = 0
    private var sessionGeneration: UInt64 = 0
    private var isProtectedSessionActive: Bool

    init(
        repository: any OrganizationMediaRepository,
        preparer: any OrganizationImagePreparing,
        protectedStore: any OrganizationMediaProtectedStore,
        uuids: any UUIDProviding,
        logger: any OrganizationAssetLogSink =
            NullOrganizationAssetLogSink(),
        initiallyActive: Bool = true,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.repository = repository
        self.preparer = preparer
        self.protectedStore = protectedStore
        submissionFactory = OrganizationAssetSubmissionFactory(
            uuids: uuids
        )
        self.logger = logger
        isProtectedSessionActive = initiallyActive
        nowProvider = now
    }

    func prepareSubmission(
        transferableData: Data,
        kind: OrganizationMediaKind,
        altText: String,
        collection: OrganizationMediaCollection
    ) async throws -> OrganizationMediaUploadSubmission {
        guard
            cancellationDepth == 0,
            isProtectedSessionActive
        else {
            throw CancellationError()
        }
        let generation = sessionGeneration
        let operationID = UUID()
        let task = Task {
            try await self.performPrepareSubmission(
                transferableData: transferableData,
                kind: kind,
                altText: altText,
                collection: collection,
                generation: generation
            )
        }
        activePreparations[operationID] = task
        return try await awaitPreparation(
            task,
            operationID: operationID,
            generation: generation
        )
    }

    func prepareReplay(
        of original: OrganizationMediaUploadSubmission,
        transferableData: Data
    ) async throws -> OrganizationMediaUploadSubmission {
        guard
            cancellationDepth == 0,
            isProtectedSessionActive
        else {
            throw CancellationError()
        }
        let generation = sessionGeneration
        let operationID = UUID()
        let task = Task {
            try await self.performPrepareReplay(
                of: original,
                transferableData: transferableData,
                generation: generation
            )
        }
        activePreparations[operationID] = task
        return try await awaitPreparation(
            task,
            operationID: operationID,
            generation: generation
        )
    }

    private func performPrepareSubmission(
        transferableData: Data,
        kind: OrganizationMediaKind,
        altText: String,
        collection: OrganizationMediaCollection,
        generation: UInt64
    ) async throws -> OrganizationMediaUploadSubmission {
        try requireActiveSession(generation)
        try collection.validate()
        let trimmedAltText = altText.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard
            !trimmedAltText.isEmpty,
            trimmedAltText == altText,
            altText.count <= 500
        else {
            throw OrganizationAssetError.invalidAltText
        }
        if kind == .gallery, collection.gallery.count >= 12 {
            throw OrganizationAssetError.collectionLimitReached
        }

        let stripped = try await preparer.prepare(
            transferableData: transferableData,
            kind: kind
        )
        try requireActiveSession(generation)
        let prepared = try await protectedStore.stage(
            stripped.bytes,
            contentType: stripped.contentType
        )
        do {
            try requireActiveSession(generation)
            guard
                prepared.byteCount == stripped.bytes.count,
                prepared.contentType == stripped.contentType
            else {
                throw OrganizationAssetError.invalidSelection
            }
            let clientRequestID =
                await submissionFactory.mediaSubmissionID()
            try requireActiveSession(generation)
            return OrganizationMediaUploadSubmission(
                clientRequestID: clientRequestID,
                kind: kind,
                altText: altText,
                prepared: prepared,
                expectedOrganizationRevision:
                    kind == .gallery
                    ? nil
                    : collection.organizationRevision,
                expectedGalleryRevision:
                    kind == .gallery
                    ? collection.galleryRevision
                    : nil
            )
        } catch is CancellationError {
            guard
                await protectedStore.purge(
                    prepared.handle,
                    reason: .cancelled
                )
            else {
                throw OrganizationAssetError.unavailable
            }
            throw CancellationError()
        } catch {
            guard
                await protectedStore.purge(
                    prepared.handle,
                    reason: .validationFailed
                )
            else {
                throw OrganizationAssetError.unavailable
            }
            if let error = error as? OrganizationAssetError {
                throw error
            }
            throw OrganizationAssetError.invalidSelection
        }
    }

    private func performPrepareReplay(
        of original: OrganizationMediaUploadSubmission,
        transferableData: Data,
        generation: UInt64
    ) async throws -> OrganizationMediaUploadSubmission {
        try requireActiveSession(generation)
        let command = OrganizationMediaReservationCommand(
            clientRequestID: original.clientRequestID,
            kind: original.kind,
            altText: original.altText,
            expectedOrganizationRevision:
                original.expectedOrganizationRevision,
            expectedGalleryRevision:
                original.expectedGalleryRevision
        )
        try command.validate()
        let stripped = try await preparer.prepare(
            transferableData: transferableData,
            kind: original.kind
        )
        try requireActiveSession(generation)
        let prepared = try await protectedStore.stage(
            stripped.bytes,
            contentType: stripped.contentType
        )
        do {
            try requireActiveSession(generation)
            guard
                prepared.byteCount == stripped.bytes.count,
                prepared.contentType == stripped.contentType
            else {
                throw OrganizationAssetError.invalidSelection
            }
            return OrganizationMediaUploadSubmission(
                clientRequestID: original.clientRequestID,
                kind: original.kind,
                altText: original.altText,
                prepared: prepared,
                expectedOrganizationRevision:
                    original.expectedOrganizationRevision,
                expectedGalleryRevision:
                    original.expectedGalleryRevision
            )
        } catch is CancellationError {
            guard
                await protectedStore.purge(
                    prepared.handle,
                    reason: .cancelled
                )
            else {
                throw OrganizationAssetError.unavailable
            }
            throw CancellationError()
        } catch {
            guard
                await protectedStore.purge(
                    prepared.handle,
                    reason: .validationFailed
                )
            else {
                throw OrganizationAssetError.unavailable
            }
            throw error as? OrganizationAssetError
                ?? OrganizationAssetError.invalidSelection
        }
    }

    func submit(
        _ submission: OrganizationMediaUploadSubmission,
        organizationID: String
    ) async throws -> OrganizationMediaUploadResult {
        guard
            cancellationDepth == 0,
            isProtectedSessionActive
        else {
            _ = await purge(submission, reason: .cancelled)
            throw CancellationError()
        }
        let generation = sessionGeneration
        if let active = activeUploads[submission.clientRequestID] {
            let value = try await active.value
            try requireActiveSession(generation)
            return value
        }
        let task = Task {
            try await self.performSubmit(
                submission,
                organizationID: organizationID,
                generation: generation
            )
        }
        activeUploads[submission.clientRequestID] = task
        return try await withTaskCancellationHandler {
            do {
                let value = try await task.value
                activeUploads.removeValue(
                    forKey: submission.clientRequestID
                )
                try requireActiveSession(generation)
                return value
            } catch {
                activeUploads.removeValue(
                    forKey: submission.clientRequestID
                )
                throw error
            }
        } onCancel: {
            task.cancel()
        }
    }

    func cancelProtectedTasks() async {
        cancellationDepth += 1
        sessionGeneration &+= 1
        isProtectedSessionActive = false
        defer {
            cancellationDepth -= 1
        }
        let preparationTasks = Array(activePreparations.values)
        let uploadTasks = Array(activeUploads.values)
        for task in preparationTasks {
            task.cancel()
        }
        for task in uploadTasks {
            task.cancel()
        }
        for task in preparationTasks {
            _ = await task.result
        }
        for task in uploadTasks {
            _ = await task.result
        }
        activePreparations.removeAll(keepingCapacity: false)
        activeUploads.removeAll(keepingCapacity: false)
        reservations.removeAll(keepingCapacity: false)
    }

    func activateProtectedSession(userID _: UUID) async {
        while cancellationDepth > 0 {
            await Task.yield()
        }
        sessionGeneration &+= 1
        isProtectedSessionActive = true
    }

    private func awaitPreparation(
        _ task: PreparationTask,
        operationID: UUID,
        generation: UInt64
    ) async throws -> OrganizationMediaUploadSubmission {
        do {
            let value = try await withTaskCancellationHandler {
                try await task.value
            } onCancel: {
                task.cancel()
            }
            activePreparations.removeValue(forKey: operationID)
            do {
                try requireActiveSession(generation)
            } catch {
                _ = await purge(value, reason: .cancelled)
                throw error
            }
            return value
        } catch {
            activePreparations.removeValue(forKey: operationID)
            throw error
        }
    }

    private func performSubmit(
        _ submission: OrganizationMediaUploadSubmission,
        organizationID: String,
        generation: UInt64
    ) async throws -> OrganizationMediaUploadResult {
        let command = OrganizationMediaReservationCommand(
            clientRequestID: submission.clientRequestID,
            kind: submission.kind,
            altText: submission.altText,
            expectedOrganizationRevision:
                submission.expectedOrganizationRevision,
            expectedGalleryRevision:
                submission.expectedGalleryRevision
        )
        let reservation: OrganizationMediaReservation
        do {
            reservation = try await repository.reserveUpload(
                organizationID: organizationID,
                command: command
            )
            try requireActiveSession(generation)
            try reservation.validate()
            try Task.checkCancellation()
            guard
                reservation.organizationID == organizationID,
                reservation.kind == submission.kind
            else {
                throw OrganizationAssetError.invalidResponse
            }
            if let previous =
                reservations[submission.clientRequestID],
                previous.organizationID != reservation.organizationID
                    || previous.uploadID != reservation.uploadID
                    || previous.kind != reservation.kind
                    || previous.expiresAt != reservation.expiresAt
            {
                throw OrganizationAssetError.invalidResponse
            }
            reservations[submission.clientRequestID] = reservation
        } catch is CancellationError {
            guard await purge(submission, reason: .cancelled) else {
                throw OrganizationAssetError.unavailable
            }
            throw CancellationError()
        } catch {
            let normalized = Self.assetError(error)
            let purged = await purge(
                submission,
                reason: normalized == .conflict
                    ? .conflict
                    : .reservationFailed
            )
            throw purged ? normalized : .unavailable
        }

        guard reservation.expiresAt > nowProvider() else {
            guard await purge(submission, reason: .expired) else {
                throw OrganizationAssetError.unavailable
            }
            throw OrganizationAssetError.reservationExpired
        }

        do {
            let result = try await repository.uploadReserved(
                reservation,
                prepared: submission.prepared
            )
            try requireActiveSession(generation)
            try result.validate()
            guard result.asset.kind == submission.kind else {
                throw OrganizationAssetError.invalidResponse
            }
            guard await purge(submission, reason: .uploaded) else {
                throw OrganizationAssetError.unavailable
            }
            try requireActiveSession(generation)
            await logger.record(
                .mutationFinished(
                    kind: .mediaUpload,
                    outcome: .succeeded
                )
            )
            try requireActiveSession(generation)
            return result
        } catch is CancellationError {
            guard await purge(submission, reason: .cancelled) else {
                throw OrganizationAssetError.unavailable
            }
            await logger.record(
                .mutationFinished(
                    kind: .mediaUpload,
                    outcome: .cancelled
                )
            )
            throw CancellationError()
        } catch {
            let normalized = Self.assetError(error)
            let reason: OrganizationMediaPurgeReason
            switch normalized {
            case .reservationExpired:
                reason = .expired
            case .conflict:
                reason = .conflict
            case .invalidResponse:
                reason = .validationFailed
            default:
                reason = .uploadFailed
            }
            let purged = await purge(
                submission,
                reason: reason,
                retainingReservation: reason == .uploadFailed
            )
            await logger.record(
                .mutationFinished(
                    kind: .mediaUpload,
                    outcome: normalized == .conflict && purged
                        ? .conflict
                        : .rejected
                )
            )
            throw purged ? normalized : .unavailable
        }
    }

    @discardableResult
    func discard(
        _ submission: OrganizationMediaUploadSubmission
    ) async -> Bool {
        await purge(submission, reason: .discarded)
    }

    @discardableResult
    func replace(
        _ submission: OrganizationMediaUploadSubmission
    ) async -> Bool {
        await purge(submission, reason: .reselected)
    }

    @discardableResult
    func tearDown(
        _ submission: OrganizationMediaUploadSubmission
    ) async -> Bool {
        await purge(submission, reason: .viewTornDown)
    }

    @discardableResult
    private func purge(
        _ submission: OrganizationMediaUploadSubmission,
        reason: OrganizationMediaPurgeReason,
        retainingReservation: Bool = false
    ) async -> Bool {
        if !retainingReservation {
            reservations.removeValue(
                forKey: submission.clientRequestID
            )
        }
        return await protectedStore.purge(
            submission.prepared.handle,
            reason: reason
        )
    }

    private func requireActiveSession(
        _ generation: UInt64
    ) throws {
        try Task.checkCancellation()
        guard
            cancellationDepth == 0,
            isProtectedSessionActive,
            sessionGeneration == generation
        else {
            throw CancellationError()
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
