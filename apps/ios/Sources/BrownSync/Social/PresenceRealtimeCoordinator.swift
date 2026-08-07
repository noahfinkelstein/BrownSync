import Foundation
import Supabase

protocol PresenceRealtimeChannel: Sendable {
    func anyActionInvalidations() async -> AsyncStream<Void>
    func connectionFailures() async -> AsyncStream<Void>
    func subscribeWithError() async throws
    func remove() async
}

extension PresenceRealtimeChannel {
    func connectionFailures() async -> AsyncStream<Void> {
        AsyncStream { $0.finish() }
    }
}

protocol PresenceReconciliationTicking: Sendable {
    func ticks() async -> AsyncStream<Void>
}

struct PresenceReconciliationTicker: PresenceReconciliationTicking {
    let interval: Duration

    init(interval: Duration = .seconds(60)) {
        self.interval = interval
    }

    func ticks() async -> AsyncStream<Void> {
        AsyncStream { continuation in
            let task = Task {
                let clock = ContinuousClock()
                while !Task.isCancelled {
                    do {
                        try await clock.sleep(for: interval)
                    } catch {
                        break
                    }
                    guard !Task.isCancelled else { break }
                    continuation.yield(())
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }
}

actor SupabasePresenceRealtimeChannel: PresenceRealtimeChannel {
    private let client: SupabaseClient
    private var channel: RealtimeChannelV2?

    init(client: SupabaseClient) {
        self.client = client
    }

    func anyActionInvalidations() async -> AsyncStream<Void> {
        let channel = activeChannel()
        let changes = channel.postgresChange(
            AnyAction.self,
            schema: "public",
            table: SocialTable.presenceState.rawValue
        )
        return AsyncStream { continuation in
            let bridge = Task {
                for await _ in changes {
                    guard !Task.isCancelled else { break }
                    continuation.yield(())
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in
                bridge.cancel()
            }
        }
    }

    func connectionFailures() async -> AsyncStream<Void> {
        let statuses = activeChannel().statusChange
        return AsyncStream { continuation in
            let bridge = Task {
                var hasSubscribed = false
                for await status in statuses {
                    guard !Task.isCancelled else { break }
                    switch status {
                    case .subscribed:
                        hasSubscribed = true
                    case .unsubscribed where hasSubscribed:
                        continuation.yield(())
                    case .unsubscribed, .subscribing, .unsubscribing:
                        break
                    @unknown default:
                        continuation.yield(())
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in
                bridge.cancel()
            }
        }
    }

    func subscribeWithError() async throws {
        try await activeChannel().subscribeWithError()
    }

    func remove() async {
        guard let channel else { return }
        self.channel = nil
        await client.removeChannel(channel)
    }

    private func activeChannel() -> RealtimeChannelV2 {
        if let channel {
            return channel
        }
        let channel = client.channel(
            "presence-state-\(UUID().uuidString.lowercased())"
        )
        self.channel = channel
        return channel
    }
}

actor PresenceRealtimeCoordinator: RealtimeChannelRemoving {
    private let repository: any SocialRepository
    private let cache: SensitiveCache
    private let channel: any PresenceRealtimeChannel
    private let reconciliationTicker: any PresenceReconciliationTicking
    private let timeSource: any PresenceTimeProviding

    private var invalidationTask: Task<Void, Never>?
    private var reconciliationTask: Task<Void, Never>?
    private var connectionFailureTask: Task<Void, Never>?
    private var expiryTask: Task<Void, Never>?
    private var expiryTaskGeneration: UInt64 = 0
    private var isActive = false
    private var reconciliationInFlight: Set<UInt64> = []
    private var reconciliationRequested: Set<UInt64> = []
    private var lifecycleGeneration: UInt64 = 0
    private var nextSurfaceLease: UInt64 = 0
    private var activeSurfaceLease: UInt64?
    private var lifecycleTransitionInProgress = false
    private var lifecycleTransitionWaiters:
        [CheckedContinuation<Void, Never>] = []
#if DEBUG
    private var lifecycleTransitionCountWaiters:
        [(Int, CheckedContinuation<Void, Never>)] = []
    private var stopRequestSequence: UInt64 = 0
    private var stopRequestWaiters:
        [(UInt64, CheckedContinuation<Void, Never>)] = []
    private var connectionFailureCallbackCount = 0
    private var connectionFailureCallbackWaiters:
        [(Int, CheckedContinuation<Void, Never>)] = []
#endif

    init(
        repository: any SocialRepository,
        cache: SensitiveCache,
        channel: any PresenceRealtimeChannel,
        reconciliationTicker: any PresenceReconciliationTicking,
        timeSource: any PresenceTimeProviding
    ) {
        self.repository = repository
        self.cache = cache
        self.channel = channel
        self.reconciliationTicker = reconciliationTicker
        self.timeSource = timeSource
    }

    func friendsSurfaceBecameActive() async throws {
        _ = try await acquireFriendsSurface()
    }

    func acquireFriendsSurface() async throws -> UInt64 {
        await acquireLifecycleTransition()
        do {
            let lease = try await activateWhileTransitionHeld()
            releaseLifecycleTransition()
            return lease
        } catch {
            releaseLifecycleTransition()
            throw error
        }
    }

    func friendsSurfaceBecameInactive() async {
        await stopAndPurge(reason: .sceneBackgrounded)
    }

    func releaseFriendsSurface(lease: UInt64) async {
        await acquireLifecycleTransition()
        guard activeSurfaceLease == lease else {
            releaseLifecycleTransition()
            return
        }
        await stopWhileTransitionHeld(reason: .sceneBackgrounded)
        releaseLifecycleTransition()
    }

    func connectionFailed() async {
        await stopAndPurge(reason: .sceneBackgrounded)
    }

    func removeRealtimeChannels() async {
        await stopAndPurge(reason: .signedOut)
    }

#if DEBUG
    func currentStopRequestSequence() -> UInt64 {
        stopRequestSequence
    }

    func waitForStopRequest(after sequence: UInt64) async {
        guard stopRequestSequence <= sequence else { return }
        await withCheckedContinuation { continuation in
            stopRequestWaiters.append((sequence, continuation))
        }
    }

    func waitForLifecycleTransitionWaiterCount(
        _ count: Int
    ) async {
        guard lifecycleTransitionWaiters.count < count else { return }
        await withCheckedContinuation { continuation in
            lifecycleTransitionCountWaiters.append(
                (count, continuation)
            )
        }
    }

    func waitForConnectionFailureCallbackCount(
        _ count: Int
    ) async {
        guard connectionFailureCallbackCount < count else { return }
        await withCheckedContinuation { continuation in
            connectionFailureCallbackWaiters.append(
                (count, continuation)
            )
        }
    }
#endif

    private func activateWhileTransitionHeld() async throws -> UInt64 {
        try Task.checkCancellation()
        if isActive, let activeSurfaceLease {
            return activeSurfaceLease
        }

        lifecycleGeneration &+= 1
        let generation = lifecycleGeneration
        nextSurfaceLease &+= 1
        let lease = nextSurfaceLease
        do {
            let invalidations = await channel.anyActionInvalidations()
            try Task.checkCancellation()
            let failures = await channel.connectionFailures()
            try Task.checkCancellation()
            try await channel.subscribeWithError()
            try Task.checkCancellation()
            guard lifecycleGeneration == generation else {
                throw CancellationError()
            }

            isActive = true
            activeSurfaceLease = lease
            let ticks = await reconciliationTicker.ticks()
            try await requestAuthoritativeReconciliation(
                for: generation
            )
            try Task.checkCancellation()
            guard
                isActive,
                lifecycleGeneration == generation,
                activeSurfaceLease == lease
            else {
                throw CancellationError()
            }

            invalidationTask = Task { [weak self] in
                for await _ in invalidations {
                    guard !Task.isCancelled else { return }
                    await self?.reconcileOrPurgeFriends(
                        expectedGeneration: generation
                    )
                }
            }
            reconciliationTask = Task { [weak self] in
                for await _ in ticks {
                    guard !Task.isCancelled else { return }
                    await self?.reconcileOrPurgeFriends(
                        expectedGeneration: generation
                    )
                }
            }
            connectionFailureTask = Task { [weak self] in
                for await _ in failures {
                    guard !Task.isCancelled else { return }
                    await self?.connectionFailed(
                        expectedGeneration: generation
                    )
                    return
                }
            }
            return lease
        } catch {
            if lifecycleGeneration == generation {
                await stopWhileTransitionHeld(
                    reason: .sceneBackgrounded
                )
            }
            throw error
        }
    }

    private func reconcileOrPurgeFriends(
        expectedGeneration: UInt64
    ) async {
        guard
            isActive,
            lifecycleGeneration == expectedGeneration
        else {
            return
        }
        do {
            try await requestAuthoritativeReconciliation(
                for: expectedGeneration
            )
        } catch {
            guard
                isActive,
                lifecycleGeneration == expectedGeneration
            else {
                return
            }
            await cache.purgeVisibleFriendPresence()
            guard
                isActive,
                lifecycleGeneration == expectedGeneration
            else {
                return
            }
            cancelExpiryTask()
        }
    }

    private func requestAuthoritativeReconciliation(
        for expectedGeneration: UInt64
    ) async throws {
        try Task.checkCancellation()
        guard
            isActive,
            lifecycleGeneration == expectedGeneration
        else {
            throw CancellationError()
        }
        if reconciliationInFlight.contains(expectedGeneration) {
            reconciliationRequested.insert(expectedGeneration)
            return
        }

        reconciliationInFlight.insert(expectedGeneration)
        do {
            repeat {
                try Task.checkCancellation()
                reconciliationRequested.remove(expectedGeneration)
                let cacheGeneration =
                    await cache.currentProtectionGeneration()
                try Task.checkCancellation()
                let presence =
                    try await repository.fetchVisiblePresence()
                try Task.checkCancellation()
                guard
                    isActive,
                    lifecycleGeneration == expectedGeneration
                else {
                    throw CancellationError()
                }
                let time = await timeSource.now()
                try Task.checkCancellation()
                guard
                    isActive,
                    lifecycleGeneration == expectedGeneration
                else {
                    throw CancellationError()
                }
                let replaced = await cache.replaceVisiblePresence(
                    presence,
                    at: time,
                    ifGeneration: cacheGeneration
                )
                try Task.checkCancellation()
                guard
                    isActive,
                    lifecycleGeneration == expectedGeneration
                else {
                    throw CancellationError()
                }
                if replaced {
                    await scheduleEarliestExpiry(
                        from: time,
                        expectedGeneration: expectedGeneration
                    )
                } else {
                    reconciliationRequested.insert(
                        expectedGeneration
                    )
                }
            } while
                reconciliationRequested.contains(expectedGeneration)
                    && isActive
                    && lifecycleGeneration == expectedGeneration
            reconciliationInFlight.remove(expectedGeneration)
            reconciliationRequested.remove(expectedGeneration)
        } catch {
            reconciliationInFlight.remove(expectedGeneration)
            reconciliationRequested.remove(expectedGeneration)
            throw error
        }
    }

    private func scheduleEarliestExpiry(
        from time: PresenceTime,
        expectedGeneration: UInt64
    ) async {
        guard
            isActive,
            lifecycleGeneration == expectedGeneration
        else {
            return
        }
        cancelExpiryTask()
        guard
            isActive,
            lifecycleGeneration == expectedGeneration,
            let expiry = await cache.nextPresenceExpiry()
        else {
            expiryTask = nil
            return
        }
        let delay = max(0, expiry.timeIntervalSince(time.wallClock))
        expiryTaskGeneration &+= 1
        let expiryGeneration = expiryTaskGeneration
        expiryTask = Task { [weak self] in
            do {
                try await Task.sleep(
                    for: .milliseconds(Int64((delay * 1_000).rounded(.up)))
                )
            } catch {
                return
            }
            await self?.expireAndReschedule(
                expectedGeneration: expectedGeneration,
                expiryGeneration: expiryGeneration
            )
        }
    }

    private func expireAndReschedule(
        expectedGeneration: UInt64,
        expiryGeneration: UInt64
    ) async {
        guard
            isActive,
            lifecycleGeneration == expectedGeneration,
            expiryTaskGeneration == expiryGeneration
        else {
            return
        }
        // Clear, rather than cancel, the handle for the task currently
        // executing this callback.
        expiryTask = nil
        let time = await timeSource.now()
        _ = await cache.visiblePresence(at: time)
        await scheduleEarliestExpiry(
            from: time,
            expectedGeneration: expectedGeneration
        )
    }

    private func stopAndPurge(reason: SensitiveCachePurgeReason) async {
        registerStopRequest()
        let localPurge = Task { [cache] in
            await cache.purge(reason: reason)
        }
        await acquireLifecycleTransition()
        await localPurge.value
        await stopWhileTransitionHeld(
            reason: reason,
            alreadyPurged: true
        )
        releaseLifecycleTransition()
    }

    private func registerStopRequest() {
#if DEBUG
        stopRequestSequence &+= 1
        resumeStopRequestWaiters()
#endif
        lifecycleGeneration &+= 1
        isActive = false
        activeSurfaceLease = nil
        invalidationTask?.cancel()
        reconciliationTask?.cancel()
        connectionFailureTask?.cancel()
        cancelExpiryTask()
        invalidationTask = nil
        reconciliationTask = nil
        connectionFailureTask = nil
        expiryTask = nil
        reconciliationInFlight.removeAll()
        reconciliationRequested.removeAll()
    }

    private func connectionFailed(
        expectedGeneration: UInt64
    ) async {
#if DEBUG
        connectionFailureCallbackCount += 1
        resumeConnectionFailureCallbackWaiters()
#endif
        await acquireLifecycleTransition()
        guard
            isActive,
            lifecycleGeneration == expectedGeneration
        else {
            releaseLifecycleTransition()
            return
        }
        // This callback is running on the stored failure task. Clearing its
        // handle prevents stop cleanup from cancelling its own remove/purge
        // path before cancellation-aware transport work completes.
        connectionFailureTask = nil
        await stopWhileTransitionHeld(reason: .sceneBackgrounded)
        releaseLifecycleTransition()
    }

    private func stopWhileTransitionHeld(
        reason: SensitiveCachePurgeReason,
        alreadyPurged: Bool = false
    ) async {
        lifecycleGeneration &+= 1
        isActive = false
        activeSurfaceLease = nil
        invalidationTask?.cancel()
        reconciliationTask?.cancel()
        connectionFailureTask?.cancel()
        cancelExpiryTask()
        invalidationTask = nil
        reconciliationTask = nil
        connectionFailureTask = nil
        expiryTask = nil
        await channel.remove()
        if !alreadyPurged {
            await cache.purge(reason: reason)
        }
    }

    private func cancelExpiryTask() {
        expiryTaskGeneration &+= 1
        expiryTask?.cancel()
        expiryTask = nil
    }

    private func acquireLifecycleTransition() async {
        guard lifecycleTransitionInProgress else {
            lifecycleTransitionInProgress = true
            return
        }
        await withCheckedContinuation { continuation in
            lifecycleTransitionWaiters.append(continuation)
#if DEBUG
            resumeLifecycleTransitionCountWaiters()
#endif
        }
    }

    private func releaseLifecycleTransition() {
        if lifecycleTransitionWaiters.isEmpty {
            lifecycleTransitionInProgress = false
        } else {
            lifecycleTransitionWaiters.removeFirst().resume()
        }
    }

#if DEBUG
    private func resumeStopRequestWaiters() {
        var remaining:
            [(UInt64, CheckedContinuation<Void, Never>)] = []
        for waiter in stopRequestWaiters {
            if stopRequestSequence > waiter.0 {
                waiter.1.resume()
            } else {
                remaining.append(waiter)
            }
        }
        stopRequestWaiters = remaining
    }

    private func resumeLifecycleTransitionCountWaiters() {
        var remaining:
            [(Int, CheckedContinuation<Void, Never>)] = []
        for waiter in lifecycleTransitionCountWaiters {
            if lifecycleTransitionWaiters.count >= waiter.0 {
                waiter.1.resume()
            } else {
                remaining.append(waiter)
            }
        }
        lifecycleTransitionCountWaiters = remaining
    }

    private func resumeConnectionFailureCallbackWaiters() {
        var remaining:
            [(Int, CheckedContinuation<Void, Never>)] = []
        for waiter in connectionFailureCallbackWaiters {
            if connectionFailureCallbackCount >= waiter.0 {
                waiter.1.resume()
            } else {
                remaining.append(waiter)
            }
        }
        connectionFailureCallbackWaiters = remaining
    }
#endif
}
