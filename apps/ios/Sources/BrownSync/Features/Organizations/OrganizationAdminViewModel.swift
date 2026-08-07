import Combine
import Foundation

struct SafeFailurePresentation: Equatable, Sendable {
    let title: String
    let message: String
    let systemImage: String
    let retryLabel: String?
    let accessibilityLabel: String

    static func make(for error: Error) -> SafeFailurePresentation {
        let title: String
        let message: String
        let systemImage: String
        let retryLabel: String?

        if let apiError = error as? APIError {
            switch apiError {
            case .unauthorized, .brownMembershipRequired:
                title = "Brown sign-in required"
                message =
                    "Sign in with an admitted Brown account to continue."
                systemImage = "lock"
                retryLabel = nil
            case .recentAuthenticationRequired:
                title = "Sign in again"
                message =
                    "A fresh Brown sign-in is required for this action."
                systemImage = "person.badge.key"
                retryLabel = "Sign In Again"
            case .forbidden(code: _):
                title = "Access unavailable"
                message =
                    "Your account is not authorized for this organization action."
                systemImage = "hand.raised"
                retryLabel = nil
            case .rateLimited:
                title = "Please wait"
                message =
                    "Too many organization requests were made. Try again shortly."
                systemImage = "clock"
                retryLabel = "Try Again"
            case .unavailable:
                title = "Organizations unavailable"
                message =
                    "The organization service is temporarily unavailable."
                systemImage = "wifi.exclamationmark"
                retryLabel = "Try Again"
            case .invalidResponse:
                title = "Organization data unavailable"
                message =
                    "BrownSync could not safely read the server response."
                systemImage = "exclamationmark.triangle"
                retryLabel = "Try Again"
            case .server(status: _, code: _):
                title = "Organization request failed"
                message =
                    "The server could not complete this organization request."
                systemImage = "exclamationmark.triangle"
                retryLabel = "Try Again"
            }
        } else if
            let ownershipError =
                error as? OrganizationOwnershipError
        {
            switch ownershipError {
            case .emptyEditPatch:
                title = "No changes selected"
                message =
                    "Choose at least one organization field to change."
                systemImage = "pencil"
                retryLabel = nil
            case .invalidReviewPageSize:
                title = "Review queue unavailable"
                message = "The review queue request was invalid."
                systemImage = "list.bullet.rectangle"
                retryLabel = "Try Again"
            }
        } else if
            (error as? OrganizationAdminViewModelError)
                == .operationInProgress
        {
            title = "Change already in progress"
            message =
                "Wait for the current organization change to finish."
            systemImage = "hourglass"
            retryLabel = nil
        } else {
            title = "Organization request failed"
            message =
                "BrownSync could not complete this organization request."
            systemImage = "exclamationmark.triangle"
            retryLabel = "Try Again"
        }

        return SafeFailurePresentation(
            title: title,
            message: message,
            systemImage: systemImage,
            retryLabel: retryLabel,
            accessibilityLabel: "\(title). \(message)"
        )
    }
}

enum OrganizationReviewLoadMoreState: Equatable, Sendable {
    case idle
    case loading
    case failed(SafeFailurePresentation)
    case complete
}

struct OrganizationReviewContent: Equatable, Sendable {
    let claims: [OrganizationReviewableClaim]
    let next: OrganizationClaimCursor?
    let loadMoreState: OrganizationReviewLoadMoreState
    let decidingClaimID: UUID?
    let actionFailure: SafeFailurePresentation?
}

enum OrganizationAdminViewModelError: Error, Equatable, Sendable {
    case operationInProgress
}

typealias OrganizationTerminalAuthorizationHandler =
    @MainActor @Sendable (APIError) async -> Void

@MainActor
final class OrganizationAdminViewModel: ObservableObject {
    enum State: Equatable, Sendable {
        case authenticationRequired
        case loading
        case empty
        case loaded(OrganizationAccessSnapshot)
        case failed(SafeFailurePresentation)
    }

    enum ReviewState: Equatable, Sendable {
        case inactive
        case authenticationRequired
        case loading
        case empty
        case loaded(OrganizationReviewContent)
        case failed(SafeFailurePresentation)
    }

    private struct ActiveContext: Equatable, Sendable {
        let ownerID: UUID
        let lifecycleGeneration: UInt64
        let cacheProtection: OrganizationOwnershipCacheProtection
    }

    private struct ReviewContext: Equatable, Sendable {
        let active: ActiveContext
        let lifecycleGeneration: UInt64
        let cacheProtection: OrganizationOwnershipReviewProtection
    }

    private struct ActivationOperation {
        let id: UInt64
        let ownerID: UUID
        let task: Task<Void, Never>
    }

    private struct ReviewActivationOperation {
        let id: UInt64
        let context: ActiveContext
        let task: Task<Void, Never>
    }

    private struct PaginationOperation {
        let id: UInt64
        let context: ReviewContext
        let cursor: OrganizationClaimCursor
        let task: Task<Void, Never>
    }

    private struct ClaimInput: Equatable, Sendable {
        let organizationID: String
        let evidence: String?
    }

    private struct UpdateInput: Equatable, Sendable {
        let organizationID: String
        let baseline: PublicOrganizationProfile
        let expectedRevision: Int
        let patch: OrganizationEditPatchIntent
    }

    private struct DecisionInput: Equatable, Sendable {
        let claimID: UUID
        let approve: Bool
        let note: String?
    }

    private struct CreateOperation {
        let id: UInt64
        let context: ActiveContext
        let input: OrganizationCreateDraft
        let task: Task<OrganizationCreateOutcome, Error>
    }

    private struct ClaimOperation {
        let id: UInt64
        let context: ActiveContext
        let input: ClaimInput
        let task: Task<OrganizationClaimOutcome, Error>
    }

    private struct UpdateOperation {
        let id: UInt64
        let context: ActiveContext
        let input: UpdateInput
        let task: Task<OrganizationEditOutcome, Error>
    }

    private struct DecisionOperation {
        let id: UInt64
        let context: ReviewContext
        let input: DecisionInput
        let task: Task<OrganizationClaimDecisionOutcome, Error>
    }

    @Published private(set) var state: State = .authenticationRequired
    @Published private(set) var reviewState: ReviewState = .inactive
    @Published private(set) var accessFailure:
        SafeFailurePresentation?
    @Published private(set) var isRefreshingAccess = false

    private let repository: any OrganizationOwnershipRepository
    private let cache: OrganizationOwnershipCache
    private let terminalAuthorizationHandler:
        OrganizationTerminalAuthorizationHandler

    private var activeOwnerID: UUID?
    private var activeCacheProtection:
        OrganizationOwnershipCacheProtection?
    private var activeReviewCacheProtection:
        OrganizationOwnershipReviewProtection?
    private var lifecycleGeneration: UInt64 = 0
    private var reviewLifecycleGeneration: UInt64 = 0
    private var operationSequence: UInt64 = 0

    private var activationOperation: ActivationOperation?
    private var reviewActivationOperation:
        ReviewActivationOperation?
    private var paginationOperation: PaginationOperation?
    private var createOperation: CreateOperation?
    private var claimOperation: ClaimOperation?
    private var updateOperation: UpdateOperation?
    private var decisionOperation: DecisionOperation?

    init(
        repository: any OrganizationOwnershipRepository,
        cache: OrganizationOwnershipCache,
        terminalAuthorizationHandler:
            @escaping OrganizationTerminalAuthorizationHandler = { _ in }
    ) {
        self.repository = repository
        self.cache = cache
        self.terminalAuthorizationHandler =
            terminalAuthorizationHandler
    }

    func activate(authState: AuthState) async {
        guard case let .admitted(identity) = authState else {
            await deactivate(reason: .signedOut).value
            return
        }

        if
            activeOwnerID == identity.id,
            let activationOperation
        {
            await activationOperation.task.value
            return
        }

        if
            activeOwnerID == identity.id,
            activeCacheProtection != nil
        {
            switch state {
            case .loaded, .empty:
                return
            case .authenticationRequired, .loading, .failed:
                break
            }
        }

        beginSession(ownerID: identity.id)
        let expectedGeneration = lifecycleGeneration
        let operationID = nextOperationID()
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await performActivation(
                ownerID: identity.id,
                expectedGeneration: expectedGeneration
            )
        }
        activationOperation = ActivationOperation(
            id: operationID,
            ownerID: identity.id,
            task: task
        )
        await task.value
        if activationOperation?.id == operationID {
            activationOperation = nil
        }
    }

    func refresh(authState: AuthState) async {
        guard case let .admitted(identity) = authState else {
            await deactivate(reason: .signedOut).value
            return
        }
        if
            activeOwnerID != identity.id
                || activeCacheProtection == nil
        {
            await activate(authState: authState)
            return
        }
        if let activationOperation {
            await activationOperation.task.value
        }
        guard let context = activeContext() else { return }

        accessFailure = nil
        isRefreshingAccess = true
        do {
            let access = try await repository.access()
            try requireCurrent(context)
            guard
                await cache.replaceAccess(
                    access,
                    protection: context.cacheProtection
                )
            else {
                throw CancellationError()
            }
            try requireCurrent(context)
            state = access.isEmpty ? .empty : .loaded(access)
        } catch is CancellationError {
            return
        } catch {
            guard sessionMatches(context) else { return }
            if await handleTerminalAuthorizationIfNeeded(error) {
                return
            }
            accessFailure = SafeFailurePresentation.make(for: error)
        }
        if sessionMatches(context) {
            isRefreshingAccess = false
        }
    }

    func activateReviewQueue(authState: AuthState) async {
        guard case let .admitted(identity) = authState else {
            await deactivate(reason: .signedOut).value
            return
        }
        if
            activeOwnerID != identity.id
                || activeCacheProtection == nil
        {
            await activate(authState: authState)
        }
        if let activationOperation {
            await activationOperation.task.value
        }
        guard let activeContext = activeContext() else {
            reviewState = .authenticationRequired
            return
        }

        if
            let reviewActivationOperation,
            reviewActivationOperation.context == activeContext
        {
            await reviewActivationOperation.task.value
            return
        }
        if activeReviewCacheProtection != nil {
            switch reviewState {
            case .loaded, .empty:
                return
            case .inactive, .authenticationRequired, .loading, .failed:
                break
            }
        }

        prepareReviewActivation()
        let expectedReviewGeneration = reviewLifecycleGeneration
        let operationID = nextOperationID()
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await performReviewActivation(
                activeContext: activeContext,
                expectedReviewGeneration: expectedReviewGeneration
            )
        }
        reviewActivationOperation = ReviewActivationOperation(
            id: operationID,
            context: activeContext,
            task: task
        )
        await task.value
        if reviewActivationOperation?.id == operationID {
            reviewActivationOperation = nil
        }
    }

    func loadNextReviewPage() async {
        if let paginationOperation {
            await paginationOperation.task.value
            return
        }
        guard
            case let .loaded(content) = reviewState,
            let cursor = content.next,
            let context = reviewContext()
        else {
            return
        }

        reviewState = .loaded(
            OrganizationReviewContent(
                claims: content.claims,
                next: content.next,
                loadMoreState: .loading,
                decidingClaimID: content.decidingClaimID,
                actionFailure: content.actionFailure
            )
        )
        let operationID = nextOperationID()
        let task = Task { @MainActor [weak self] in
            guard let self else { return }
            await performPagination(
                cursor: cursor,
                context: context
            )
        }
        paginationOperation = PaginationOperation(
            id: operationID,
            context: context,
            cursor: cursor,
            task: task
        )
        await task.value
        if paginationOperation?.id == operationID {
            paginationOperation = nil
        }
    }

    @discardableResult
    func deactivateReviewQueue() -> Task<Void, Never> {
        reviewLifecycleGeneration &+= 1
        reviewState = .inactive
        let protection = activeReviewCacheProtection
        activeReviewCacheProtection = nil
        reviewActivationOperation?.task.cancel()
        reviewActivationOperation = nil
        paginationOperation?.task.cancel()
        paginationOperation = nil
        decisionOperation?.task.cancel()
        decisionOperation = nil

        return Task {
            guard let protection else { return }
            _ = await cache.purgeReviewOnNavigationExit(
                protection: protection
            )
        }
    }

    @discardableResult
    func deactivate(
        reason: SensitiveCachePurgeReason = .signedOut
    ) -> Task<Void, Never> {
        lifecycleGeneration &+= 1
        reviewLifecycleGeneration &+= 1
        state = .authenticationRequired
        reviewState = .authenticationRequired
        accessFailure = nil
        isRefreshingAccess = false

        let protection = activeCacheProtection
        activeOwnerID = nil
        activeCacheProtection = nil
        activeReviewCacheProtection = nil
        cancelAllWork()

        return Task {
            guard let protection else { return }
            _ = await cache.purge(
                reason: reason,
                protection: protection
            )
        }
    }

    func create(
        _ draft: OrganizationCreateDraft
    ) async throws -> OrganizationCreateOutcome {
        let context = try requireActiveContext()
        if let existing = createOperation {
            if
                existing.context == context,
                existing.input == draft
            {
                return try await existing.task.value
            }
            if existing.context == context {
                throw OrganizationAdminViewModelError.operationInProgress
            }
            existing.task.cancel()
            createOperation = nil
        }

        let operationID = nextOperationID()
        let task: Task<OrganizationCreateOutcome, Error> = Task { @MainActor [weak self] in
            guard let self else { throw CancellationError() }
            return try await performMutation(context: context) {
                try await repository.create(draft)
            }
        }
        createOperation = CreateOperation(
            id: operationID,
            context: context,
            input: draft,
            task: task
        )
        let result = await task.result
        if createOperation?.id == operationID {
            createOperation = nil
        }
        return try result.get()
    }

    func claim(
        organizationID: String,
        evidence: String?
    ) async throws -> OrganizationClaimOutcome {
        let context = try requireActiveContext()
        let input = ClaimInput(
            organizationID: organizationID,
            evidence: evidence
        )
        if let existing = claimOperation {
            if
                existing.context == context,
                existing.input == input
            {
                return try await existing.task.value
            }
            if existing.context == context {
                throw OrganizationAdminViewModelError.operationInProgress
            }
            existing.task.cancel()
            claimOperation = nil
        }

        let operationID = nextOperationID()
        let task: Task<OrganizationClaimOutcome, Error> = Task { @MainActor [weak self] in
            guard let self else { throw CancellationError() }
            return try await performMutation(context: context) {
                try await repository.claim(
                    organizationID: organizationID,
                    evidence: evidence
                )
            }
        }
        claimOperation = ClaimOperation(
            id: operationID,
            context: context,
            input: input,
            task: task
        )
        let result = await task.result
        if claimOperation?.id == operationID {
            claimOperation = nil
        }
        return try result.get()
    }

    func update(
        organizationID: String,
        baseline: PublicOrganizationProfile,
        expectedRevision: Int,
        patch: OrganizationEditPatchIntent
    ) async throws -> OrganizationEditOutcome {
        let context = try requireActiveContext()
        let input = UpdateInput(
            organizationID: organizationID,
            baseline: baseline,
            expectedRevision: expectedRevision,
            patch: patch
        )
        if let existing = updateOperation {
            if
                existing.context == context,
                existing.input == input
            {
                return try await existing.task.value
            }
            if existing.context == context {
                throw OrganizationAdminViewModelError.operationInProgress
            }
            existing.task.cancel()
            updateOperation = nil
        }

        let operationID = nextOperationID()
        let task: Task<OrganizationEditOutcome, Error> = Task { @MainActor [weak self] in
            guard let self else { throw CancellationError() }
            return try await performMutation(context: context) {
                try await repository.update(
                    organizationID: organizationID,
                    baseline: baseline,
                    expectedRevision: expectedRevision,
                    patch: patch
                )
            }
        }
        updateOperation = UpdateOperation(
            id: operationID,
            context: context,
            input: input,
            task: task
        )
        let result = await task.result
        if updateOperation?.id == operationID {
            updateOperation = nil
        }
        return try result.get()
    }

    func decideClaim(
        claimID: UUID,
        approve: Bool,
        note: String?
    ) async throws -> OrganizationClaimDecisionOutcome {
        let context = try requireReviewContext()
        let input = DecisionInput(
            claimID: claimID,
            approve: approve,
            note: note
        )
        if let existing = decisionOperation {
            if
                existing.context == context,
                existing.input == input
            {
                return try await existing.task.value
            }
            if existing.context == context {
                throw OrganizationAdminViewModelError.operationInProgress
            }
            existing.task.cancel()
            decisionOperation = nil
        }

        markDecisionStarted(claimID: claimID)
        let operationID = nextOperationID()
        let task: Task<OrganizationClaimDecisionOutcome, Error> = Task { @MainActor [weak self] in
            guard let self else { throw CancellationError() }
            return try await performDecision(
                input: input,
                context: context
            )
        }
        decisionOperation = DecisionOperation(
            id: operationID,
            context: context,
            input: input,
            task: task
        )
        let result = await task.result
        if decisionOperation?.id == operationID {
            decisionOperation = nil
        }
        return try result.get()
    }

    private func beginSession(ownerID: UUID) {
        lifecycleGeneration &+= 1
        reviewLifecycleGeneration &+= 1
        cancelAllWork()
        activeOwnerID = ownerID
        activeCacheProtection = nil
        activeReviewCacheProtection = nil
        state = .loading
        reviewState = .inactive
        accessFailure = nil
        isRefreshingAccess = false
    }

    private func prepareReviewActivation() {
        reviewLifecycleGeneration &+= 1
        reviewActivationOperation?.task.cancel()
        reviewActivationOperation = nil
        paginationOperation?.task.cancel()
        paginationOperation = nil
        decisionOperation?.task.cancel()
        decisionOperation = nil
        activeReviewCacheProtection = nil
        reviewState = .loading
    }

    private func performActivation(
        ownerID: UUID,
        expectedGeneration: UInt64
    ) async {
        let protection = await cache.activate(ownerID: ownerID)
        guard
            lifecycleGeneration == expectedGeneration,
            activeOwnerID == ownerID
        else {
            _ = await cache.purge(
                reason: .signedOut,
                protection: protection
            )
            return
        }
        activeCacheProtection = protection
        let context = ActiveContext(
            ownerID: ownerID,
            lifecycleGeneration: expectedGeneration,
            cacheProtection: protection
        )

        do {
            let access = try await repository.access()
            try requireCurrent(context)
            guard
                await cache.replaceAccess(
                    access,
                    protection: protection
                )
            else {
                throw CancellationError()
            }
            try requireCurrent(context)
            state = access.isEmpty ? .empty : .loaded(access)
        } catch is CancellationError {
            return
        } catch {
            guard sessionMatches(context) else { return }
            if await handleTerminalAuthorizationIfNeeded(error) {
                return
            }
            state = .failed(SafeFailurePresentation.make(for: error))
        }
    }

    private func performReviewActivation(
        activeContext: ActiveContext,
        expectedReviewGeneration: UInt64
    ) async {
        guard sessionMatches(activeContext) else { return }
        guard
            let protection = await cache.beginReview(
                ownedBy: activeContext.ownerID,
                ifGeneration:
                    activeContext.cacheProtection.generation
            )
        else {
            return
        }
        guard
            sessionMatches(activeContext),
            reviewLifecycleGeneration == expectedReviewGeneration
        else {
            _ = await cache.purgeReviewOnNavigationExit(
                protection: protection
            )
            return
        }
        activeReviewCacheProtection = protection
        let context = ReviewContext(
            active: activeContext,
            lifecycleGeneration: expectedReviewGeneration,
            cacheProtection: protection
        )

        do {
            let page = try await repository.reviewPage(
                after: nil,
                limit: 50
            )
            try requireCurrent(context)
            guard
                await cache.replaceReviewClaims(
                    page.claims,
                    protection: protection
                )
            else {
                throw CancellationError()
            }
            try requireCurrent(context)
            setReviewPage(page)
        } catch is CancellationError {
            return
        } catch {
            guard reviewMatches(context) else { return }
            if await handleTerminalAuthorizationIfNeeded(error) {
                return
            }
            reviewState = .failed(
                SafeFailurePresentation.make(for: error)
            )
        }
    }

    private func performPagination(
        cursor: OrganizationClaimCursor,
        context: ReviewContext
    ) async {
        do {
            let page = try await repository.reviewPage(
                after: cursor,
                limit: 50
            )
            try requireCurrent(context)
            guard
                await cache.appendReviewClaims(
                    page.claims,
                    protection: context.cacheProtection
                )
            else {
                throw CancellationError()
            }
            try requireCurrent(context)

            let current = currentReviewContent()
            let combinedClaims =
                (current?.claims ?? []) + page.claims
            reviewState = .loaded(
                OrganizationReviewContent(
                    claims: combinedClaims,
                    next: page.next,
                    loadMoreState:
                        page.next == nil ? .complete : .idle,
                    decidingClaimID: current?.decidingClaimID,
                    actionFailure: current?.actionFailure
                )
            )
        } catch is CancellationError {
            return
        } catch {
            guard reviewMatches(context) else { return }
            if await handleTerminalAuthorizationIfNeeded(error) {
                return
            }
            guard let current = currentReviewContent() else {
                reviewState = .failed(
                    SafeFailurePresentation.make(for: error)
                )
                return
            }
            reviewState = .loaded(
                OrganizationReviewContent(
                    claims: current.claims,
                    next: current.next,
                    loadMoreState: .failed(
                        SafeFailurePresentation.make(for: error)
                    ),
                    decidingClaimID: current.decidingClaimID,
                    actionFailure: current.actionFailure
                )
            )
        }
    }

    private func performMutation<Value: Sendable>(
        context: ActiveContext,
        operation: () async throws -> Value
    ) async throws -> Value {
        try requireCurrent(context)
        do {
            let value = try await operation()
            try requireCurrent(context)
            return value
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            guard sessionMatches(context) else {
                throw CancellationError()
            }
            _ = await handleTerminalAuthorizationIfNeeded(error)
            throw error
        }
    }

    private func performDecision(
        input: DecisionInput,
        context: ReviewContext
    ) async throws -> OrganizationClaimDecisionOutcome {
        try requireCurrent(context)
        do {
            let outcome = try await repository.decideClaim(
                claimID: input.claimID,
                approve: input.approve,
                note: input.note
            )
            try requireCurrent(context)
            guard
                await cache.removeReviewClaim(
                    id: input.claimID,
                    protection: context.cacheProtection
                )
            else {
                throw CancellationError()
            }
            try requireCurrent(context)
            markDecisionSucceeded(claimID: input.claimID)
            return outcome
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            guard reviewMatches(context) else {
                throw CancellationError()
            }
            if await handleTerminalAuthorizationIfNeeded(error) {
                throw error
            }
            markDecisionFailed(error)
            throw error
        }
    }

    private func setReviewPage(
        _ page: OrganizationClaimReviewPage
    ) {
        if page.claims.isEmpty, page.next == nil {
            reviewState = .empty
            return
        }
        reviewState = .loaded(
            OrganizationReviewContent(
                claims: page.claims,
                next: page.next,
                loadMoreState:
                    page.next == nil ? .complete : .idle,
                decidingClaimID: nil,
                actionFailure: nil
            )
        )
    }

    private func markDecisionStarted(claimID: UUID) {
        guard let content = currentReviewContent() else { return }
        reviewState = .loaded(
            OrganizationReviewContent(
                claims: content.claims,
                next: content.next,
                loadMoreState: content.loadMoreState,
                decidingClaimID: claimID,
                actionFailure: nil
            )
        )
    }

    private func markDecisionSucceeded(claimID: UUID) {
        guard let content = currentReviewContent() else {
            reviewState = .empty
            return
        }
        let remaining = content.claims.filter {
            $0.claimID != claimID
        }
        if remaining.isEmpty, content.next == nil {
            reviewState = .empty
            return
        }
        reviewState = .loaded(
            OrganizationReviewContent(
                claims: remaining,
                next: content.next,
                loadMoreState: content.loadMoreState,
                decidingClaimID: nil,
                actionFailure: nil
            )
        )
    }

    private func markDecisionFailed(_ error: Error) {
        guard let content = currentReviewContent() else { return }
        reviewState = .loaded(
            OrganizationReviewContent(
                claims: content.claims,
                next: content.next,
                loadMoreState: content.loadMoreState,
                decidingClaimID: nil,
                actionFailure: SafeFailurePresentation.make(
                    for: error
                )
            )
        )
    }

    private func currentReviewContent() -> OrganizationReviewContent? {
        guard case let .loaded(content) = reviewState else {
            return nil
        }
        return content
    }

    private func activeContext() -> ActiveContext? {
        guard
            let activeOwnerID,
            let activeCacheProtection
        else {
            return nil
        }
        return ActiveContext(
            ownerID: activeOwnerID,
            lifecycleGeneration: lifecycleGeneration,
            cacheProtection: activeCacheProtection
        )
    }

    private func reviewContext() -> ReviewContext? {
        guard
            let active = activeContext(),
            let activeReviewCacheProtection
        else {
            return nil
        }
        return ReviewContext(
            active: active,
            lifecycleGeneration: reviewLifecycleGeneration,
            cacheProtection: activeReviewCacheProtection
        )
    }

    private func requireActiveContext() throws -> ActiveContext {
        guard let context = activeContext() else {
            throw APIError.unauthorized
        }
        return context
    }

    private func requireReviewContext() throws -> ReviewContext {
        guard let context = reviewContext() else {
            throw APIError.unauthorized
        }
        return context
    }

    private func requireCurrent(_ context: ActiveContext) throws {
        guard sessionMatches(context) else {
            throw CancellationError()
        }
    }

    private func requireCurrent(_ context: ReviewContext) throws {
        guard reviewMatches(context) else {
            throw CancellationError()
        }
    }

    private func sessionMatches(_ context: ActiveContext) -> Bool {
        activeOwnerID == context.ownerID
            && lifecycleGeneration == context.lifecycleGeneration
            && activeCacheProtection == context.cacheProtection
    }

    private func reviewMatches(_ context: ReviewContext) -> Bool {
        sessionMatches(context.active)
            && reviewLifecycleGeneration
                == context.lifecycleGeneration
            && activeReviewCacheProtection
                == context.cacheProtection
    }

    private func handleTerminalAuthorizationIfNeeded(
        _ error: Error
    ) async -> Bool {
        guard
            let apiError = error as? APIError,
            apiError == .unauthorized
                || apiError == .brownMembershipRequired
        else {
            return false
        }
        let purge = deactivate(reason: .authExpired)
        await purge.value
        await terminalAuthorizationHandler(apiError)
        return true
    }

    private func cancelAllWork() {
        activationOperation?.task.cancel()
        activationOperation = nil
        reviewActivationOperation?.task.cancel()
        reviewActivationOperation = nil
        paginationOperation?.task.cancel()
        paginationOperation = nil
        createOperation?.task.cancel()
        createOperation = nil
        claimOperation?.task.cancel()
        claimOperation = nil
        updateOperation?.task.cancel()
        updateOperation = nil
        decisionOperation?.task.cancel()
        decisionOperation = nil
    }

    private func nextOperationID() -> UInt64 {
        operationSequence &+= 1
        return operationSequence
    }
}

private extension OrganizationAccessSnapshot {
    var isEmpty: Bool {
        memberships.isEmpty && claims.isEmpty
    }
}
