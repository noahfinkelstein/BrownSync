import Combine
import Foundation

struct UserEventFailurePresentation: Equatable, Sendable {
    let title: String
    let message: String
    let systemImage: String
    let retryLabel: String?
    let accessibilityLabel: String

    static func make(for error: Error) -> UserEventFailurePresentation {
        let title: String
        let message: String
        let systemImage: String
        let retryLabel: String?

        if let repositoryError = error as? UserEventRepositoryError {
            switch repositoryError {
            case .emptyEditPatch:
                title = "No changes selected"
                message = "Choose at least one event field to change."
                systemImage = "pencil"
                retryLabel = nil
            case .eventNoLongerEditable:
                title = "Event is read-only"
                message =
                    "Canceled or deleted events can be reviewed but cannot be edited."
                systemImage = "lock"
                retryLabel = nil
            case .invalidInput:
                title = "Check event details"
                message =
                    "Review the event fields and enter a valid lowercase HTTPS link with a host."
                systemImage = "exclamationmark.triangle"
                retryLabel = nil
            case .invalidTimeRange:
                title = "Check event times"
                message =
                    "Choose an effective end time after the effective start time."
                systemImage = "calendar.badge.exclamationmark"
                retryLabel = nil
            case .invalidPageSize, .invalidResponse:
                title = "Event data unavailable"
                message =
                    "BrownSync could not safely read the event response."
                systemImage = "exclamationmark.triangle"
                retryLabel = "Try Again"
            case .eligibilityOrAuthorityRequired:
                title = "Event access unavailable"
                message =
                    "This action requires an eligible Brown account or current organization authority."
                systemImage = "hand.raised"
                retryLabel = nil
            case .rateLimited:
                title = "Please wait"
                message =
                    "The event service received too many requests. Try again later."
                systemImage = "clock"
                retryLabel = "Try Again"
            case .requestConflict:
                title = "Request conflict"
                message =
                    "This request identity was already used for different event details."
                systemImage = "arrow.triangle.2.circlepath"
                retryLabel = nil
            case .placeUnresolved:
                title = "Place unavailable"
                message =
                    "Choose a current canonical campus place and try again."
                systemImage = "mappin.slash"
                retryLabel = nil
            case .unavailable:
                title = "Events unavailable"
                message =
                    "The event service is temporarily unavailable."
                systemImage = "wifi.exclamationmark"
                retryLabel = "Try Again"
            }
        } else if let apiError = error as? APIError {
            switch apiError {
            case .unauthorized, .brownMembershipRequired:
                title = "Brown sign-in required"
                message =
                    "Sign in with an admitted Brown account to manage events."
                systemImage = "lock"
                retryLabel = nil
            case .recentAuthenticationRequired:
                title = "Sign in again"
                message =
                    "A fresh Brown sign-in is required for this action."
                systemImage = "person.badge.key"
                retryLabel = nil
            case .forbidden(code: _):
                title = "Event access unavailable"
                message =
                    "Your account is not authorized for this event action."
                systemImage = "hand.raised"
                retryLabel = nil
            case .rateLimited:
                title = "Please wait"
                message =
                    "The event service received too many requests. Try again later."
                systemImage = "clock"
                retryLabel = "Try Again"
            case .unavailable:
                title = "Events unavailable"
                message =
                    "The event service is temporarily unavailable."
                systemImage = "wifi.exclamationmark"
                retryLabel = "Try Again"
            case .invalidResponse, .server(status: _, code: _):
                title = "Event request failed"
                message =
                    "BrownSync could not safely complete this event request."
                systemImage = "exclamationmark.triangle"
                retryLabel = "Try Again"
            }
        } else {
            title = "Event request failed"
            message =
                "BrownSync could not complete this event request."
            systemImage = "exclamationmark.triangle"
            retryLabel = "Try Again"
        }

        return UserEventFailurePresentation(
            title: title,
            message: message,
            systemImage: systemImage,
            retryLabel: retryLabel,
            accessibilityLabel: "\(title). \(message)"
        )
    }
}

struct UserEventProtectedFlowLease: Hashable, Sendable {
    fileprivate let id: UInt64
}

struct UserEventProtectedFlowExit: Equatable, Sendable {
    fileprivate let generation: UInt64
}

@MainActor
final class UserEventManagementViewModel: ObservableObject {
    enum State: Equatable, Sendable {
        case authenticationRequired
        case loading
        case empty
        case loaded([ManagedUserEvent])
        case submitting
        case created(eventID: UUID, revision: Int)
        case replayed(eventID: UUID, revision: Int)
        case conflict(UserEventEditConflictReview)
        case canceling
        case canceled(UserEventMutationOutcome)
        case failed(UserEventFailurePresentation)
    }

    @Published private(set) var state: State = .authenticationRequired
    @Published private(set) var events: [ManagedUserEvent] = []
    @Published private(set) var pendingSubmission: UserEventCreateSubmission?
    @Published private(set) var conflictReview: UserEventEditConflictReview?
    @Published private(set) var editBaseline: ManagedUserEvent?
    @Published private(set) var createRequiresExplicitReset = false

    private let repository: any UserEventRepository
    private let cache: UserEventManagementCache

    private var activeOwnerID: UUID?
    private var activeCacheProtection: UserEventManagementCacheProtection?
    private var lifecycleGeneration: UInt64 = 0
    private var loadGeneration: UInt64 = 0
    private var createOperationSequence: UInt64 = 0
    private var activeCreateOperationID: UInt64?
    private var flowLeaseSequence: UInt64 = 0
    private var flowExitGeneration: UInt64 = 0
    private var activeFlowLeases: Set<UserEventProtectedFlowLease> = []
    private var createRequestBarriersByOwner: [UUID: CreateRequestBarrier] = [:]

    init(
        repository: any UserEventRepository,
        cache: UserEventManagementCache
    ) {
        self.repository = repository
        self.cache = cache
    }

    func enterProtectedFlow() -> UserEventProtectedFlowLease {
        flowLeaseSequence &+= 1
        flowExitGeneration &+= 1
        let lease = UserEventProtectedFlowLease(id: flowLeaseSequence)
        activeFlowLeases.insert(lease)
        return lease
    }

    func prepareProtectedFlowExit(
        _ lease: UserEventProtectedFlowLease
    ) -> UserEventProtectedFlowExit? {
        guard activeFlowLeases.remove(lease) != nil else {
            return nil
        }
        flowExitGeneration &+= 1
        guard activeFlowLeases.isEmpty else { return nil }
        return UserEventProtectedFlowExit(
            generation: flowExitGeneration
        )
    }

    func completeProtectedFlowExit(
        _ exit: UserEventProtectedFlowExit
    ) async {
        guard
            activeFlowLeases.isEmpty,
            flowExitGeneration == exit.generation
        else {
            return
        }
        await purgeOnNavigationExit()
    }

    func activate(authState: AuthState) async {
        guard case .admitted(let identity) = authState else {
            await deactivate(reason: .signedOut)
            return
        }
        guard
            activeOwnerID != identity.id
                || activeCacheProtection == nil
        else {
            return
        }
        await load(ownerID: identity.id, replacesSession: true)
    }

    func refresh(authState: AuthState) async {
        guard case .admitted(let identity) = authState else {
            await deactivate(reason: .signedOut)
            return
        }
        await load(
            ownerID: identity.id,
            replacesSession: activeOwnerID != identity.id
        )
    }

    func submitCreate(
        draft: UserEventCreateDraft,
        authState: AuthState
    ) async {
        guard
            !createRequiresExplicitReset,
            let operationID = beginCreateOperation()
        else {
            return
        }
        defer { finishCreateOperation(operationID) }
        state = .submitting

        guard
            let context = await admittedContext(
                authState: authState
            )
        else {
            return
        }
        guard !createRequiresExplicitReset else { return }

        let submission: UserEventCreateSubmission
        if let pendingSubmission,
            pendingSubmission.draft == draft
        {
            submission = pendingSubmission
        } else if let requestID = issuedCreateRequestID(
            for: context.ownerID
        ) {
            submission = UserEventCreateSubmission(
                requestID: requestID,
                draft: draft
            )
            pendingSubmission = submission
        } else {
            submission = await repository.prepareCreate(draft)
            guard contextIsCurrent(context) else { return }
            pendingSubmission = submission
        }

        await performCreate(
            submission: submission,
            context: context
        )
    }

    func retryCreate(authState: AuthState) async {
        guard
            !createRequiresExplicitReset,
            let operationID = beginCreateOperation()
        else {
            return
        }
        defer { finishCreateOperation(operationID) }
        state = .submitting

        guard
            let context = await admittedContext(
                authState: authState
            )
        else {
            return
        }
        guard !createRequiresExplicitReset else { return }
        guard let submission = pendingSubmission else {
            state = events.isEmpty ? .empty : .loaded(events)
            return
        }
        await performCreate(
            submission: submission,
            context: context
        )
    }

    func startNewCreateSubmission() {
        guard createRequiresExplicitReset else { return }
        if let activeOwnerID {
            createRequestBarriersByOwner[activeOwnerID] = nil
        }
        createRequiresExplicitReset = false
        pendingSubmission = nil
        state = events.isEmpty ? .empty : .loaded(events)
    }

    func beginEditing(_ event: ManagedUserEvent) {
        editBaseline = event
        conflictReview = nil
    }

    func endEditing() {
        editBaseline = nil
        conflictReview = nil
        switch state {
        case .conflict, .failed:
            state = events.isEmpty ? .empty : .loaded(events)
        default:
            break
        }
    }

    @discardableResult
    func update(
        patch: UserEventEditPatchIntent,
        authState: AuthState
    ) async -> ManagedUserEvent? {
        guard
            let baseline = editBaseline,
            baseline.isEditable
        else {
            state = .failed(
                UserEventFailurePresentation.make(
                    for: UserEventRepositoryError
                        .eventNoLongerEditable
                )
            )
            return nil
        }
        guard
            let context = await admittedContext(
                authState: authState
            )
        else {
            return nil
        }

        conflictReview = nil
        state = .submitting
        do {
            let outcome = try await repository.update(
                eventID: baseline.id,
                baseline: baseline,
                expectedRevision: baseline.revision,
                patch: patch
            )
            guard contextIsCurrent(context) else { return nil }
            switch outcome {
            case .updated(let mutation):
                let latest = try await repository.detail(
                    eventID: baseline.id
                )
                guard
                    contextIsCurrent(context),
                    latest.id == baseline.id,
                    latest.revision >= mutation.revision
                else {
                    return nil
                }
                guard
                    await cache.upsert(
                        latest,
                        protection: context.cacheProtection
                    )
                else {
                    return nil
                }
                guard contextIsCurrent(context) else { return nil }
                if let index = events.firstIndex(
                    where: { $0.id == latest.id }
                ) {
                    events[index] = latest
                } else {
                    events.insert(latest, at: 0)
                }
                editBaseline = latest
                state = events.isEmpty ? .empty : .loaded(events)
                return latest
            case .conflict(let review):
                editBaseline = review.latestEvent
                conflictReview = review
                state = .conflict(review)
                return nil
            }
        } catch {
            await handle(
                error: error,
                context: context
            )
            return nil
        }
    }

    func cancel(
        eventID: UUID,
        authState: AuthState
    ) async {
        guard
            let context = await admittedContext(
                authState: authState
            )
        else {
            return
        }

        state = .canceling
        do {
            let outcome = try await repository.cancel(
                eventID: eventID
            )
            guard contextIsCurrent(context) else { return }
            guard
                await cache.remove(
                    eventID: eventID,
                    protection: context.cacheProtection
                )
            else {
                return
            }
            guard contextIsCurrent(context) else { return }
            events.removeAll { $0.id == eventID }
            editBaseline = nil
            state = .canceled(outcome)
        } catch {
            await handle(
                error: error,
                context: context
            )
        }
    }

    func resetPresentationToList() {
        conflictReview = nil
        state = events.isEmpty ? .empty : .loaded(events)
    }

    func purgeOnNavigationExit() async {
        flowExitGeneration &+= 1
        lifecycleGeneration &+= 1
        loadGeneration &+= 1
        activeOwnerID = nil
        activeCacheProtection = nil
        clearProtectedPresentation()
        await cache.purgeOnNavigationExit()
    }

    func deactivate(reason: SensitiveCachePurgeReason) async {
        flowExitGeneration &+= 1
        lifecycleGeneration &+= 1
        loadGeneration &+= 1
        if reason == .accountDeleted, let activeOwnerID {
            createRequestBarriersByOwner[activeOwnerID] = nil
        }
        activeOwnerID = nil
        activeCacheProtection = nil
        clearProtectedPresentation()
        await cache.purge(reason: reason)
    }

    private func load(
        ownerID: UUID,
        replacesSession: Bool
    ) async {
        if replacesSession {
            lifecycleGeneration &+= 1
            activeOwnerID = ownerID
            activeCacheProtection = nil
            clearProtectedPresentation()
            synchronizeCreateResetBarrier()
            let expectedGeneration = lifecycleGeneration
            let protection = await cache.activate(ownerID: ownerID)
            guard
                activeOwnerID == ownerID,
                lifecycleGeneration == expectedGeneration
            else {
                return
            }
            activeCacheProtection = protection
        } else if activeOwnerID == nil
            || activeCacheProtection == nil
        {
            lifecycleGeneration &+= 1
            activeOwnerID = ownerID
            activeCacheProtection = nil
            synchronizeCreateResetBarrier()
            let expectedGeneration = lifecycleGeneration
            let protection = await cache.activate(ownerID: ownerID)
            guard
                activeOwnerID == ownerID,
                lifecycleGeneration == expectedGeneration
            else {
                return
            }
            activeCacheProtection = protection
        }

        guard let activeCacheProtection else { return }
        loadGeneration &+= 1
        let requestGeneration = loadGeneration
        guard
            let cacheLoadProtection = await cache.beginLoad(
                protection: activeCacheProtection
            )
        else {
            return
        }
        let context = LoadContext(
            active: ActiveContext(
                ownerID: ownerID,
                generation: lifecycleGeneration,
                cacheProtection: activeCacheProtection
            ),
            generation: requestGeneration,
            cacheProtection: cacheLoadProtection
        )
        state = .loading
        do {
            let loadedEvents =
                try await repository.allManageableEvents()
            guard loadContextIsCurrent(context) else { return }
            guard
                await cache.replaceEvents(
                    loadedEvents,
                    loadProtection: context.cacheProtection
                )
            else {
                return
            }
            guard loadContextIsCurrent(context) else { return }
            events = loadedEvents
            state =
                loadedEvents.isEmpty
                ? .empty
                : .loaded(loadedEvents)
        } catch {
            await handleLoad(
                error: error,
                context: context
            )
        }
    }

    private func admittedContext(
        authState: AuthState
    ) async -> ActiveContext? {
        guard case .admitted(let identity) = authState else {
            await deactivate(reason: .signedOut)
            return nil
        }

        if activeOwnerID != identity.id {
            lifecycleGeneration &+= 1
            activeOwnerID = identity.id
            activeCacheProtection = nil
            clearProtectedPresentation()
            synchronizeCreateResetBarrier()
            let expectedGeneration = lifecycleGeneration
            let protection = await cache.activate(
                ownerID: identity.id
            )
            guard
                activeOwnerID == identity.id,
                lifecycleGeneration == expectedGeneration
            else {
                return nil
            }
            activeCacheProtection = protection
        } else if activeCacheProtection == nil {
            lifecycleGeneration &+= 1
            let expectedGeneration = lifecycleGeneration
            let protection = await cache.activate(
                ownerID: identity.id
            )
            guard
                activeOwnerID == identity.id,
                lifecycleGeneration == expectedGeneration
            else {
                return nil
            }
            activeCacheProtection = protection
        }
        guard let activeCacheProtection else { return nil }
        return ActiveContext(
            ownerID: identity.id,
            generation: lifecycleGeneration,
            cacheProtection: activeCacheProtection
        )
    }

    private func performCreate(
        submission: UserEventCreateSubmission,
        context: ActiveContext
    ) async {
        markCreateRequestIssued(
            ownerID: context.ownerID,
            requestID: submission.requestID
        )
        do {
            let outcome = try await repository.create(submission)
            markCreateRequestAccepted(
                ownerID: context.ownerID,
                requestID: submission.requestID
            )
            guard contextIsCurrent(context) else { return }
            pendingSubmission = nil
            switch outcome {
            case .created(let eventID, let revision):
                state = .created(
                    eventID: eventID,
                    revision: revision
                )
            case .replayed(let eventID, let revision):
                state = .replayed(
                    eventID: eventID,
                    revision: revision
                )
            }
        } catch {
            if (error as? UserEventRepositoryError) == .requestConflict {
                markCreateRequestConsumed(
                    ownerID: context.ownerID,
                    requestID: submission.requestID
                )
                if contextIsCurrent(context),
                    pendingSubmission?.requestID == submission.requestID
                {
                    pendingSubmission = nil
                }
            }
            await handle(
                error: error,
                context: context
            )
        }
    }

    private func handle(
        error: Error,
        context: ActiveContext
    ) async {
        guard contextIsCurrent(context) else { return }
        if (error as? APIError) == .unauthorized {
            await deactivate(reason: .authExpired)
            return
        }
        state = .failed(
            UserEventFailurePresentation.make(for: error)
        )
    }

    private func handleLoad(
        error: Error,
        context: LoadContext
    ) async {
        guard loadContextIsCurrent(context) else { return }
        if (error as? APIError) == .unauthorized {
            await deactivate(reason: .authExpired)
            return
        }
        guard loadContextIsCurrent(context) else { return }
        state = .failed(
            UserEventFailurePresentation.make(for: error)
        )
    }

    private func clearProtectedPresentation() {
        events = []
        pendingSubmission = nil
        conflictReview = nil
        editBaseline = nil
        createRequiresExplicitReset = false
        state = .authenticationRequired
    }

    private func issuedCreateRequestID(
        for ownerID: UUID
    ) -> UUID? {
        guard
            let barrier = createRequestBarriersByOwner[ownerID],
            barrier.state == .issued
        else {
            return nil
        }
        return barrier.requestID
    }

    private func markCreateRequestIssued(
        ownerID: UUID,
        requestID: UUID
    ) {
        createRequestBarriersByOwner[ownerID] = CreateRequestBarrier(
            requestID: requestID,
            state: .issued
        )
    }

    private func markCreateRequestAccepted(
        ownerID: UUID,
        requestID: UUID
    ) {
        guard
            createRequestBarriersByOwner[ownerID]?.requestID
                == requestID
        else {
            return
        }
        createRequestBarriersByOwner[ownerID] = CreateRequestBarrier(
            requestID: requestID,
            state: .accepted
        )
        if activeOwnerID == ownerID {
            createRequiresExplicitReset = true
        }
    }

    private func markCreateRequestConsumed(
        ownerID: UUID,
        requestID: UUID
    ) {
        guard
            createRequestBarriersByOwner[ownerID]?.requestID
                == requestID
        else {
            return
        }
        createRequestBarriersByOwner[ownerID] = CreateRequestBarrier(
            requestID: requestID,
            state: .consumed
        )
        if activeOwnerID == ownerID {
            createRequiresExplicitReset = true
        }
    }

    private func synchronizeCreateResetBarrier() {
        guard let activeOwnerID else {
            createRequiresExplicitReset = false
            return
        }
        createRequiresExplicitReset =
            createRequestBarriersByOwner[activeOwnerID]?.state
            .requiresExplicitReset
            ?? false
    }

    private func beginCreateOperation() -> UInt64? {
        guard activeCreateOperationID == nil else { return nil }
        createOperationSequence &+= 1
        activeCreateOperationID = createOperationSequence
        return createOperationSequence
    }

    private func finishCreateOperation(_ operationID: UInt64) {
        guard activeCreateOperationID == operationID else { return }
        activeCreateOperationID = nil
    }

    private func contextIsCurrent(
        _ context: ActiveContext
    ) -> Bool {
        activeOwnerID == context.ownerID
            && lifecycleGeneration == context.generation
            && activeCacheProtection == context.cacheProtection
    }

    private func loadContextIsCurrent(
        _ context: LoadContext
    ) -> Bool {
        contextIsCurrent(context.active)
            && loadGeneration == context.generation
    }

    private struct ActiveContext: Equatable, Sendable {
        let ownerID: UUID
        let generation: UInt64
        let cacheProtection: UserEventManagementCacheProtection
    }

    private struct LoadContext: Equatable, Sendable {
        let active: ActiveContext
        let generation: UInt64
        let cacheProtection: UserEventManagementCacheLoadProtection
    }

    private struct CreateRequestBarrier: Equatable, Sendable {
        enum State: Equatable, Sendable {
            case issued
            case accepted
            case consumed

            var requiresExplicitReset: Bool {
                switch self {
                case .issued:
                    false
                case .accepted, .consumed:
                    true
                }
            }
        }

        let requestID: UUID
        let state: State
    }
}
