import Foundation

enum PresenceWriteDisposition: Equatable, Sendable {
    case sent
    case coalesced
}

enum PresenceWriteCoordinatorError: Error, Equatable {
    case protectedSessionInactive
    case unconfirmedPrivacyActionPending
}

protocol PresenceWriteSleeping: Sendable {
    func sleep(for duration: Duration) async throws
}

struct ContinuousPresenceWriteSleeper: PresenceWriteSleeping {
    func sleep(for duration: Duration) async throws {
        try await Task.sleep(for: duration)
    }
}

enum UnconfirmedPrivacyAction: Equatable, Sendable {
    case clearPresence
    case setGhost(Bool)
    case revokePresenceShare(UUID)
    case blockUser(UUID)
    case removeFriend(UUID)
}

private struct PrivacyActionContext: Sendable {
    let action: UnconfirmedPrivacyAction
    let sessionGeneration: UInt64
    let cacheSessionEpoch: UInt64
    let token: UInt64
    let isExplicitRetry: Bool
}

actor PresenceWriteCoordinator:
    ProtectedTaskCancelling,
    ProtectedTaskActivating
{
    private let repository: any SocialRepository
    private let cache: SensitiveCache
    private let timeSource: any PresenceTimeProviding
    private let sleeper: any PresenceWriteSleeping
    private let minimumSuccessfulSetInterval: Duration

    private var lastSuccessfulSetAt: Duration?
    private var pendingPresence: ConfirmedPresence?
    private var setRequestInFlight = false
    private var setRequestWaiters: [CheckedContinuation<Void, Never>] = []
    private var privacyActionDepth = 0
    private var privacyRPCInFlight = false
    private var activePrivacyActionToken: UInt64?
    private var privacyActionTokenCounter: UInt64 = 0
    private var privacyRPCWaiters:
        [(token: UInt64, continuation: CheckedContinuation<Bool, Never>)] = []
#if DEBUG
    private var privacyRPCWaiterCountWaiters:
        [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []
#endif
    private var unconfirmedPrivacyAction: UnconfirmedPrivacyAction?
    private var pendingFlushTask: Task<Void, Never>?
    private var pendingFlushGeneration: UInt64 = 0
    private var sessionActive: Bool
    private var foregroundActive = true
    private var sessionGeneration: UInt64 = 0

    init(
        repository: any SocialRepository,
        cache: SensitiveCache,
        timeSource: any PresenceTimeProviding,
        sleeper: any PresenceWriteSleeping =
            ContinuousPresenceWriteSleeper(),
        minimumSuccessfulSetInterval: Duration = .seconds(60),
        initiallyActive: Bool = true
    ) {
        self.repository = repository
        self.cache = cache
        self.timeSource = timeSource
        self.sleeper = sleeper
        self.minimumSuccessfulSetInterval =
            minimumSuccessfulSetInterval
        sessionActive = initiallyActive
    }

    func submit(
        _ presence: ConfirmedPresence
    ) async throws -> PresenceWriteDisposition {
        let expectedGeneration = sessionGeneration
        guard canPublish else {
            throw PresenceWriteCoordinatorError.protectedSessionInactive
        }
        let time = await timeSource.now()
        guard
            canPublish,
            sessionGeneration == expectedGeneration
        else {
            throw PresenceWriteCoordinatorError.protectedSessionInactive
        }
        guard
            isSetDue(at: time.monotonic),
            !setRequestInFlight,
            privacyActionDepth == 0
        else {
            pendingPresence = presence
            await schedulePendingFlush()
            return .coalesced
        }

        // A direct post-deadline submission is newer than anything that was
        // waiting for the deadline. It must replace, rather than merely race,
        // the scheduled value.
        discardPendingPresence()
        try await performSet(
            presence,
            expectedGeneration: expectedGeneration
        )
        return .sent
    }

    func flushPendingIfDue() async throws {
        try await flushPendingIfDue(scheduledGeneration: nil)
    }

    func clearPresence() async throws {
        let action = UnconfirmedPrivacyAction.clearPresence
        let context = try await preparePrivacyAction(action)
        try await executePrivacyRPC(context)
    }

    func setGhost(_ ghost: Bool) async throws {
        let action = UnconfirmedPrivacyAction.setGhost(ghost)
        let context = try await preparePrivacyAction(action)
        try await executePrivacyRPC(context)
    }

    func revokePresenceShare(viewerID: UUID) async throws {
        let action =
            UnconfirmedPrivacyAction.revokePresenceShare(viewerID)
        let context = try await preparePrivacyAction(action)
        try await executePrivacyRPC(context)
    }

    func blockUser(otherUserID: UUID) async throws {
        let action = UnconfirmedPrivacyAction.blockUser(otherUserID)
        let context = try await preparePrivacyAction(action)
        try await executePrivacyRPC(context)
    }

    func removeFriend(otherUserID: UUID) async throws {
        let action = UnconfirmedPrivacyAction.removeFriend(otherUserID)
        let context = try await preparePrivacyAction(action)
        try await executePrivacyRPC(context)
    }

    func currentUnconfirmedPrivacyAction()
        -> UnconfirmedPrivacyAction?
    {
        unconfirmedPrivacyAction
    }

#if DEBUG
    func waitForPrivacyRPCWaiterCount(_ count: Int) async {
        guard privacyRPCWaiters.count < count else { return }
        await withCheckedContinuation { continuation in
            privacyRPCWaiterCountWaiters.append(
                (count: count, continuation: continuation)
            )
        }
    }
#endif

    func activateProtectedSession(userID: UUID) async {
        await cache.setCurrentUserID(userID)
        await cache.resetUnconfirmedPrivacyAction()
        sessionGeneration &+= 1
        invalidatePrivacyRPCState()
        sessionActive = true
        unconfirmedPrivacyAction = nil
        lastSuccessfulSetAt = nil
        discardPendingPresence()
    }

    func cancelProtectedTasks() async {
        sessionGeneration &+= 1
        sessionActive = false
        unconfirmedPrivacyAction = nil
        invalidatePrivacyRPCState()
        lastSuccessfulSetAt = nil
        discardPendingPresence()
        await cache.resetUnconfirmedPrivacyAction()
    }

    func suspendPublishingForBackground() {
        sessionGeneration &+= 1
        foregroundActive = false
        invalidatePrivacyRPCState()
        lastSuccessfulSetAt = nil
        discardPendingPresence()
    }

    func resumePublishingForForeground() {
        sessionGeneration &+= 1
        foregroundActive = true
        invalidatePrivacyRPCState()
        lastSuccessfulSetAt = nil
        discardPendingPresence()
    }

    // Retained as the scene-lifecycle spelling used by existing integration
    // callers. It deliberately cannot reactivate an invalidated auth session.
    func resumeProtectedTasks() {
        resumePublishingForForeground()
    }

    private var canPublish: Bool {
        sessionActive && foregroundActive
    }

    private func flushPendingIfDue(
        scheduledGeneration: UInt64?
    ) async throws {
        if let scheduledGeneration {
            guard pendingFlushGeneration == scheduledGeneration else {
                return
            }
            // Do not cancel this task's own stored handle. A cancellation-aware
            // network stack must see a live task when the due write begins.
            pendingFlushTask = nil
        }

        guard
            !setRequestInFlight,
            privacyActionDepth == 0,
            canPublish
        else {
            return
        }
        let expectedGeneration = sessionGeneration
        let time = await timeSource.now()
        guard
            canPublish,
            sessionGeneration == expectedGeneration,
            !setRequestInFlight,
            privacyActionDepth == 0,
            let presence = pendingPresence
        else {
            return
        }
        guard isSetDue(at: time.monotonic) else {
            await schedulePendingFlush()
            return
        }

        pendingPresence = nil
        if scheduledGeneration == nil {
            cancelPendingFlush()
        }
        try await performSet(
            presence,
            expectedGeneration: expectedGeneration
        )
    }

    private func isSetDue(at monotonic: Duration) -> Bool {
        guard let lastSuccessfulSetAt else { return true }
        return monotonic
            >= lastSuccessfulSetAt + minimumSuccessfulSetInterval
    }

    private func discardPendingPresence() {
        pendingPresence = nil
        cancelPendingFlush()
    }

    private func cancelPendingFlush() {
        pendingFlushGeneration &+= 1
        pendingFlushTask?.cancel()
        pendingFlushTask = nil
    }

    private func performSet(
        _ presence: ConfirmedPresence,
        expectedGeneration: UInt64
    ) async throws {
        guard
            canPublish,
            sessionGeneration == expectedGeneration
        else {
            throw PresenceWriteCoordinatorError.protectedSessionInactive
        }
        setRequestInFlight = true
        do {
            try await repository.setPresence(presence)
            if
                canPublish,
                expectedGeneration == sessionGeneration
            {
                let completedAt = await timeSource.now()
                if
                    canPublish,
                    expectedGeneration == sessionGeneration
                {
                    lastSuccessfulSetAt = completedAt.monotonic
                }
            }
            finishSetRequest()
            await schedulePendingFlush()
        } catch {
            finishSetRequest()
            // If the first attempt failed while a newer value arrived, there
            // is no successful cooldown to honor. Release only the newer value
            // once; never retry the failed value.
            await schedulePendingFlush()
            throw error
        }
    }

    private func finishSetRequest() {
        setRequestInFlight = false
        let waiters = setRequestWaiters
        setRequestWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }

    private func waitForSetRequestToFinish() async {
        guard setRequestInFlight else { return }
        await withCheckedContinuation { continuation in
            setRequestWaiters.append(continuation)
        }
    }

    private func preparePrivacyAction(
        _ action: UnconfirmedPrivacyAction
    ) async throws -> PrivacyActionContext {
        let expectedGeneration = sessionGeneration
        guard canPublish else {
            throw PresenceWriteCoordinatorError.protectedSessionInactive
        }
        let cacheSessionEpoch =
            await cache.currentPrivacySessionEpoch()
        guard
            canPublish,
            sessionGeneration == expectedGeneration
        else {
            throw PresenceWriteCoordinatorError.protectedSessionInactive
        }
        if
            let unconfirmedPrivacyAction,
            unconfirmedPrivacyAction != action
        {
            throw PresenceWriteCoordinatorError
                .unconfirmedPrivacyActionPending
        }
        let isExplicitRetry = unconfirmedPrivacyAction == action
        privacyActionTokenCounter &+= 1
        privacyActionDepth += 1
        discardPendingPresence()
        return PrivacyActionContext(
            action: action,
            sessionGeneration: expectedGeneration,
            cacheSessionEpoch: cacheSessionEpoch,
            token: privacyActionTokenCounter,
            isExplicitRetry: isExplicitRetry
        )
    }

    private func executePrivacyRPC(
        _ context: PrivacyActionContext
    ) async throws {
        guard await acquirePrivacyRPCTurn(context) else {
            throw PresenceWriteCoordinatorError.protectedSessionInactive
        }
        var installedLocalRedaction = false
        do {
            try Task.checkCancellation()
            try requireActivePrivacyContext(context)
            if let unconfirmedPrivacyAction {
                guard
                    unconfirmedPrivacyAction == context.action,
                    context.isExplicitRetry
                else {
                    throw PresenceWriteCoordinatorError
                        .unconfirmedPrivacyActionPending
                }
            } else if context.isExplicitRetry {
                // Another explicitly-requested retry already confirmed this
                // exact action while this duplicate was waiting.
                await finishPrivacyRPC(context)
                return
            }
            guard
                let privacyEffectProtectionGeneration =
                    await cache.setUnconfirmedPrivacyAction(
                    context.action,
                    ifPrivacySessionEpoch:
                        context.cacheSessionEpoch
                )
            else {
                throw PresenceWriteCoordinatorError
                    .protectedSessionInactive
            }
            installedLocalRedaction = true
            try requireActivePrivacyContext(context)
            await waitForSetRequestToFinish()
            try Task.checkCancellation()
            try requireActivePrivacyContext(context)
            do {
                switch context.action {
                case .clearPresence:
                    try await repository.clearPresence()
                case let .setGhost(ghost):
                    try await repository.setGhost(ghost)
                case let .revokePresenceShare(viewerID):
                    try await repository.revokePresenceShare(
                        viewerID: viewerID
                    )
                case let .blockUser(otherUserID):
                    try await repository.blockUser(
                        otherUserID: otherUserID
                    )
                case let .removeFriend(otherUserID):
                    try await repository.removeFriend(
                        otherUserID: otherUserID
                    )
                }
            } catch {
                // The one allowed server attempt was ambiguous or failed.
                // Retain exactly this action before releasing a queued action,
                // so a different action cannot overwrite its retry contract.
                if isActivePrivacyContext(context) {
                    unconfirmedPrivacyAction = context.action
                }
                throw error
            }
            await applyConfirmedPrivacyEffect(
                context,
                ifProtectionGeneration:
                    privacyEffectProtectionGeneration
            )
            if isActivePrivacyContext(context) {
                if unconfirmedPrivacyAction == context.action {
                    unconfirmedPrivacyAction = nil
                }
                await cache.clearUnconfirmedPrivacyAction(
                    context.action,
                    ifPrivacySessionEpoch: context.cacheSessionEpoch
                )
            }
            await finishPrivacyRPC(context)
        } catch {
            if
                installedLocalRedaction,
                isActivePrivacyContext(context)
            {
                unconfirmedPrivacyAction = context.action
            }
            await finishPrivacyRPC(context)
            throw error
        }
    }

    private func applyConfirmedPrivacyEffect(
        _ context: PrivacyActionContext,
        ifProtectionGeneration expectedCacheGeneration: UInt64
    ) async {
        guard isActivePrivacyContext(context) else { return }
        switch context.action {
        case .setGhost(true):
            let confirmedAt = await timeSource.now()
            guard isActivePrivacyContext(context) else { return }
            await cache.retainConfirmedGhostSentinel(
                at: confirmedAt,
                ifPrivacySessionEpoch: context.cacheSessionEpoch,
                ifProtectionGeneration: expectedCacheGeneration
            )
        case .setGhost(false):
            await cache.purge(
                reason: .presenceCleared,
                ifPrivacySessionEpoch: context.cacheSessionEpoch
            )
        case
            .clearPresence,
            .revokePresenceShare,
            .blockUser,
            .removeFriend:
            break
        }
    }

    private func requireActivePrivacyContext(
        _ context: PrivacyActionContext
    ) throws {
        guard isActivePrivacyContext(context) else {
            throw PresenceWriteCoordinatorError.protectedSessionInactive
        }
    }

    private func isActivePrivacyContext(
        _ context: PrivacyActionContext
    ) -> Bool {
        canPublish
            && sessionGeneration == context.sessionGeneration
            && activePrivacyActionToken == context.token
    }

    private func acquirePrivacyRPCTurn(
        _ context: PrivacyActionContext
    ) async -> Bool {
        guard privacyRPCInFlight else {
            privacyRPCInFlight = true
            activePrivacyActionToken = context.token
            return isActivePrivacyContext(context)
        }
        return await withCheckedContinuation { continuation in
            privacyRPCWaiters.append(
                (token: context.token, continuation: continuation)
            )
#if DEBUG
            resumeSatisfiedPrivacyRPCWaiterCountWaiters()
#endif
        }
    }

    private func finishPrivacyRPC(
        _ context: PrivacyActionContext
    ) async {
        guard isActivePrivacyContext(context) else { return }
        privacyActionDepth = max(0, privacyActionDepth - 1)
        discardPendingPresence()
        if privacyRPCWaiters.isEmpty {
            privacyRPCInFlight = false
            activePrivacyActionToken = nil
        } else {
            let next = privacyRPCWaiters.removeFirst()
            activePrivacyActionToken = next.token
            next.continuation.resume(returning: true)
        }
        if privacyActionDepth == 0 {
            await schedulePendingFlush()
        }
    }

    private func invalidatePrivacyRPCState() {
        privacyActionTokenCounter &+= 1
        activePrivacyActionToken = nil
        privacyRPCInFlight = false
        privacyActionDepth = 0
        let waiters = privacyRPCWaiters
        privacyRPCWaiters.removeAll()
        waiters.forEach {
            $0.continuation.resume(returning: false)
        }
    }

#if DEBUG
    private func resumeSatisfiedPrivacyRPCWaiterCountWaiters() {
        var remaining:
            [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []
        for waiter in privacyRPCWaiterCountWaiters {
            if privacyRPCWaiters.count >= waiter.count {
                waiter.continuation.resume()
            } else {
                remaining.append(waiter)
            }
        }
        privacyRPCWaiterCountWaiters = remaining
    }
#endif

    private func schedulePendingFlush() async {
        cancelPendingFlush()
        guard
            pendingPresence != nil,
            privacyActionDepth == 0,
            !setRequestInFlight,
            canPublish
        else {
            return
        }

        let time = await timeSource.now()
        guard canPublish else { return }
        let delay: Duration
        if let lastSuccessfulSetAt {
            let dueAt =
                lastSuccessfulSetAt + minimumSuccessfulSetInterval
            delay = dueAt > time.monotonic
                ? dueAt - time.monotonic
                : .zero
        } else {
            delay = .zero
        }
        pendingFlushGeneration &+= 1
        let generation = pendingFlushGeneration
        pendingFlushTask = Task {
            [weak self, sleeper = self.sleeper] in
            do {
                try await sleeper.sleep(for: delay)
            } catch {
                return
            }
            try? await self?.flushPendingIfDue(
                scheduledGeneration: generation
            )
        }
    }
}
