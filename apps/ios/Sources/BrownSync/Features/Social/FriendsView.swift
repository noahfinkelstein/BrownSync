import Combine
import Foundation
import SwiftUI

@MainActor
final class FriendsViewModel: ObservableObject {
    private struct ActiveSurfaceContext: Sendable {
        let lifecycleGeneration: UInt64
        let lease: UInt64
    }

    struct ShareRosterEntry: Identifiable {
        let profile: SocialProfile
        let share: PresenceShare

        var id: UUID { share.viewerID }
    }

    enum FailedPrivacyAction {
        case revoke(SocialProfile)
        case remove(SocialProfile)
        case block(SocialProfile)

        var label: String {
            switch self {
            case .revoke:
                return "Retry stopping presence sharing"
            case .remove:
                return "Retry removing friend"
            case .block:
                return "Retry blocking user"
            }
        }

        var unconfirmedAction: UnconfirmedPrivacyAction {
            switch self {
            case let .revoke(profile):
                return .revokePresenceShare(profile.id)
            case let .remove(profile):
                return .removeFriend(profile.id)
            case let .block(profile):
                return .blockUser(profile.id)
            }
        }
    }

    @Published private(set) var snapshot: SocialSnapshot = .empty
    @Published private(set) var isLoading = false
    @Published var errorMessage: String?
    @Published var confirmationMessage: String?
    @Published var friendSearch = ""
    @Published var shareDuration: PresenceShareDurationOption = .fourHours
    @Published private(set) var failedPrivacyAction:
        FailedPrivacyAction?

    let currentUserID: UUID
    let dependencies: SocialDependencies
    private let places: any PlaceRepository
    private let nowProvider: @Sendable () -> Date
    private let calendar: Calendar
    private var placeNamesByID: [String: String] = [:]

    private var monitorTask: Task<Void, Never>?
    private var activationTask: Task<Void, Never>?
    private var activationTaskGeneration: UInt64?
    private var deactivationTask: Task<Void, Never>?
    private var deactivationTaskGeneration: UInt64?
    private var surfaceLease: UInt64?
    private var lifecycleGeneration: UInt64 = 0
#if DEBUG
    private struct CoalescedActivationWaiter {
        let count: Int
        let continuation: CheckedContinuation<Bool, Never>
    }

    private var coalescedActivationCount = 0
    private var coalescedActivationCountWaiters:
        [UUID: CoalescedActivationWaiter] = [:]
    private var activationDeactivationWaiterCount = 0
    private var activationDeactivationCountWaiters:
        [(Int, CheckedContinuation<Void, Never>)] = []
    private var shouldGateNextMonitorRefresh = false
    private var gatedMonitorRefreshGeneration: UInt64?
    private var gatedMonitorRefreshContinuation:
        CheckedContinuation<Void, Never>?
    private var gatedMonitorRefreshWaiters:
        [CheckedContinuation<UInt64, Never>] = []
    private var completedMonitorRefreshGenerations: Set<UInt64> = []
    private var monitorRefreshCompletionWaiters:
        [(UInt64, CheckedContinuation<Void, Never>)] = []
#endif

    init(
        currentUserID: UUID,
        dependencies: SocialDependencies,
        places: any PlaceRepository,
        now: @escaping @Sendable () -> Date = Date.init,
        calendar: Calendar = .current
    ) {
        self.currentUserID = currentUserID
        self.dependencies = dependencies
        self.places = places
        nowProvider = now
        self.calendar = calendar
    }

    var acceptedProfiles: [SocialProfile] {
        profiles(for: friendships(with: .accepted))
    }

    var incomingProfiles: [SocialProfile] {
        profiles(
            for: snapshot.friendships.filter {
                $0.status == .pending
                    && $0.addresseeID == currentUserID
            }
        )
    }

    var outgoingProfiles: [SocialProfile] {
        profiles(
            for: snapshot.friendships.filter {
                $0.status == .pending
                    && $0.requesterID == currentUserID
            }
        )
    }

    var blockedByMeProfiles: [SocialProfile] {
        profiles(
            for: snapshot.friendships.filter {
                $0.status == .blocked
                    && $0.blockedByID == currentUserID
            }
        )
    }

    var activeOutboundShares: [ShareRosterEntry] {
        let now = nowProvider()
        guard snapshot.presence.contains(where: {
            $0.userID == currentUserID
                && !$0.ghost
                && $0.placeID != nil
                && $0.expiresAt > now
        }) else {
            return []
        }
        return snapshot.shares.compactMap { share in
            guard
                share.ownerID == currentUserID,
                share.expiresAt > now,
                let profile = snapshot.profiles.first(where: {
                    $0.id == share.viewerID
                })
            else {
                return nil
            }
            return ShareRosterEntry(profile: profile, share: share)
        }
        .sorted {
            $0.profile.displayName.localizedCaseInsensitiveCompare(
                $1.profile.displayName
            ) == .orderedAscending
        }
    }

    var matchingProfiles: [SocialProfile] {
        let normalized = friendSearch.trimmingCharacters(
            in: .whitespacesAndNewlines
        ).lowercased()
        guard !normalized.isEmpty else { return [] }
        return snapshot.profiles.filter { profile in
            profile.id != currentUserID
                && (
                    profile.handle.lowercased().contains(normalized)
                        || profile.displayName.lowercased().contains(normalized)
                )
                && !snapshot.friendships.contains { friendship in
                    otherUserID(in: friendship) == profile.id
                }
        }
        .prefix(5)
        .map { $0 }
    }

    func presence(for userID: UUID) -> PresenceState? {
        snapshot.presence.first { $0.userID == userID }
    }

    func isSharing(with viewerID: UUID) -> Bool {
        snapshot.shares.contains {
            $0.ownerID == currentUserID
                && $0.viewerID == viewerID
                && $0.expiresAt > nowProvider()
        }
    }

    func placeName(for placeID: String) -> String {
        placeNamesByID[placeID]
            ?? placeID.replacingOccurrences(of: "-", with: " ")
    }

    func isPrivacyActionUnconfirmed(for profileID: UUID) -> Bool {
        switch failedPrivacyAction {
        case let .revoke(profile),
            let .remove(profile),
            let .block(profile):
            return profile.id == profileID
        case nil:
            return false
        }
    }

    func activate() async {
        if surfaceLease != nil {
            return
        }
        if let activationTask {
#if DEBUG
            recordCoalescedActivation()
#endif
            await activationTask.value
            return
        }
        if let deactivationTask {
#if DEBUG
            activationDeactivationWaiterCount += 1
            resumeActivationDeactivationCountWaiters()
#endif
            let generation = deactivationTaskGeneration
            await deactivationTask.value
#if DEBUG
            activationDeactivationWaiterCount = max(
                0,
                activationDeactivationWaiterCount - 1
            )
#endif
            if deactivationTaskGeneration == generation {
                self.deactivationTask = nil
                deactivationTaskGeneration = nil
            }
        }
        if surfaceLease != nil {
            return
        }
        if let activationTask {
#if DEBUG
            recordCoalescedActivation()
#endif
            await activationTask.value
            return
        }

        lifecycleGeneration &+= 1
        let generation = lifecycleGeneration
        let task = Task<Void, Never> { [weak self] in
            guard let self else { return }
            await self.performActivation(
                expectedGeneration: generation
            )
        }
        activationTask = task
        activationTaskGeneration = generation
        await task.value
        if activationTaskGeneration == generation {
            activationTask = nil
            activationTaskGeneration = nil
        }
    }

#if DEBUG
    func waitForCoalescedActivationCount(
        _ count: Int,
        timeout: Duration
    ) async -> Bool {
        guard coalescedActivationCount < count else { return true }
        let waiterID = UUID()
        return await withTaskGroup(of: Bool.self) { group in
            group.addTask { [weak self] in
                guard let self else { return false }
                return await self.awaitCoalescedActivationCount(
                    count,
                    waiterID: waiterID
                )
            }
            group.addTask {
                do {
                    try await Task.sleep(for: timeout)
                    return false
                } catch {
                    return false
                }
            }

            let reachedCount = await group.next() ?? false
            group.cancelAll()
            while await group.next() != nil {}
            return reachedCount
        }
    }

    func waitForActivationDeactivationWaiterCount(
        _ count: Int
    ) async {
        guard activationDeactivationWaiterCount < count else { return }
        await withCheckedContinuation { continuation in
            activationDeactivationCountWaiters.append(
                (count, continuation)
            )
        }
    }

    func gateNextMonitorRefresh() {
        shouldGateNextMonitorRefresh = true
    }

    func waitForGatedMonitorRefresh() async -> UInt64 {
        if let gatedMonitorRefreshGeneration {
            return gatedMonitorRefreshGeneration
        }
        return await withCheckedContinuation { continuation in
            gatedMonitorRefreshWaiters.append(continuation)
        }
    }

    func releaseGatedMonitorRefresh() {
        gatedMonitorRefreshContinuation?.resume()
        gatedMonitorRefreshContinuation = nil
        gatedMonitorRefreshGeneration = nil
    }

    func waitForMonitorRefreshCompletion(
        lifecycleGeneration: UInt64
    ) async {
        guard
            !completedMonitorRefreshGenerations.contains(
                lifecycleGeneration
            )
        else {
            return
        }
        await withCheckedContinuation { continuation in
            monitorRefreshCompletionWaiters.append(
                (lifecycleGeneration, continuation)
            )
        }
    }

    func currentLifecycleGenerationForTesting() -> UInt64 {
        lifecycleGeneration
    }
#endif

    @discardableResult
    func deactivate() -> Task<Void, Never> {
        lifecycleGeneration &+= 1
        snapshot = .empty
        isLoading = false
        errorMessage = nil
        confirmationMessage = nil
        friendSearch = ""
        failedPrivacyAction = nil
        let generation = lifecycleGeneration
        let activation = activationTask
        activation?.cancel()
        activationTask = nil
        activationTaskGeneration = nil
        monitorTask?.cancel()
        monitorTask = nil
        if let deactivationTask {
            return deactivationTask
        }
        let lease = surfaceLease
        surfaceLease = nil
        let task = Task {
            if lease == nil, activation != nil {
                // Activation may already own a subscribed channel while its
                // initial authoritative fetch is still waiting. Invalidate
                // that lifecycle before waiting for the activation task.
                await dependencies.realtimeCoordinator
                    .friendsSurfaceBecameInactive()
            } else {
                _ = await dependencies.cache.purge(
                    reason: .sceneBackgrounded,
                    ownedBy: currentUserID
                )
            }
            await activation?.value
            guard let lease else { return }
            await dependencies.realtimeCoordinator.releaseFriendsSurface(
                lease: lease
            )
        }
        deactivationTask = task
        deactivationTaskGeneration = generation
        return task
    }

    private func performActivation(
        expectedGeneration: UInt64
    ) async {
        await dependencies.cache.setCurrentUserID(currentUserID)
        guard
            !Task.isCancelled,
            lifecycleGeneration == expectedGeneration
        else {
            return
        }
        isLoading = snapshot == .empty
        errorMessage = nil
        do {
            try await reloadSnapshot(
                expectedLifecycleGeneration: expectedGeneration
            )
            await loadPlaceNames()
            try Task.checkCancellation()
            guard lifecycleGeneration == expectedGeneration else {
                throw CancellationError()
            }
            let lease = try await dependencies.realtimeCoordinator
                .acquireFriendsSurface()
            guard
                !Task.isCancelled,
                lifecycleGeneration == expectedGeneration
            else {
                await dependencies.realtimeCoordinator
                    .releaseFriendsSurface(lease: lease)
                return
            }
            surfaceLease = lease
            guard
                await refreshFromCache(
                    expectedLifecycleGeneration:
                        expectedGeneration,
                    expectedSurfaceLease: lease
                )
            else {
                surfaceLease = nil
                await dependencies.realtimeCoordinator
                    .releaseFriendsSurface(lease: lease)
                return
            }
            guard
                !Task.isCancelled,
                lifecycleGeneration == expectedGeneration
            else {
                surfaceLease = nil
                await dependencies.realtimeCoordinator
                    .releaseFriendsSurface(lease: lease)
                return
            }
            startCacheMonitor()
        } catch is CancellationError {
            return
        } catch {
            await refreshFromCache(
                expectedLifecycleGeneration: expectedGeneration
            )
            errorMessage =
                "Friends are temporarily unavailable. Protected details were cleared."
        }
        if lifecycleGeneration == expectedGeneration {
            isLoading = false
        }
    }

    func refresh() async {
        guard let surfaceContext = activeSurfaceContext() else {
            return
        }
        let expectedGeneration =
            surfaceContext.lifecycleGeneration
        errorMessage = nil
        do {
            try await reloadSnapshot(
                expectedLifecycleGeneration: expectedGeneration,
                expectedSurfaceLease: surfaceContext.lease
            )
            await loadPlaceNames()
            guard surfaceMatches(surfaceContext) else { return }
        } catch is CancellationError {
            return
        } catch {
            guard lifecycleGeneration == expectedGeneration else {
                return
            }
            errorMessage = "Could not refresh Friends. Please try again."
        }
    }

    func requestFriend(_ profile: SocialProfile) async {
        await performAndRefresh {
            try await dependencies.repository.requestFriend(
                addresseeID: profile.id
            )
        }
    }

    func respond(to profile: SocialProfile, accept: Bool) async {
        await performAndRefresh {
            try await dependencies.repository.respondToFriendRequest(
                requesterID: profile.id,
                accept: accept
            )
        }
    }

    func setShare(with profile: SocialProfile) async {
        await performAndRefresh {
            try await dependencies.repository.setPresenceShare(
                viewerID: profile.id,
                expiresAt: shareDuration.expiry(
                    from: nowProvider(),
                    calendar: calendar
                )
            )
        }
    }

    func revokeShare(with profile: SocialProfile) async {
        await performPrivacyAndRefresh(action: .revoke(profile)) {
            try await dependencies.writeCoordinator.revokePresenceShare(
                viewerID: profile.id
            )
        }
    }

    func remove(_ profile: SocialProfile) async {
        await performPrivacyAndRefresh(action: .remove(profile)) {
            try await dependencies.writeCoordinator.removeFriend(
                otherUserID: profile.id
            )
        }
    }

    func block(_ profile: SocialProfile) async {
        await performPrivacyAndRefresh(action: .block(profile)) {
            try await dependencies.writeCoordinator.blockUser(
                otherUserID: profile.id
            )
        }
    }

    func unblock(_ profile: SocialProfile) async {
        guard snapshot.friendships.contains(where: {
            $0.status == .blocked
                && $0.blockedByID == currentUserID
                && otherUserID(in: $0) == profile.id
        }) else {
            return
        }
        await performAndRefresh {
            try await dependencies.repository.unblockUser(
                otherUserID: profile.id
            )
        }
    }

    func retryFailedPrivacyAction() async {
        guard let failedPrivacyAction else { return }
        switch failedPrivacyAction {
        case let .revoke(profile):
            await revokeShare(with: profile)
        case let .remove(profile):
            await remove(profile)
        case let .block(profile):
            await block(profile)
        }
    }

    private func friendships(
        with status: FriendshipStatus
    ) -> [Friendship] {
        snapshot.friendships.filter { $0.status == status }
    }

    private func profiles(
        for friendships: [Friendship]
    ) -> [SocialProfile] {
        let ids = Set(
            friendships.compactMap { friendship in
                otherUserID(in: friendship)
            }
        )
        return snapshot.profiles.filter { ids.contains($0.id) }
            .sorted {
                $0.displayName.localizedCaseInsensitiveCompare(
                    $1.displayName
                ) == .orderedAscending
            }
    }

    private func otherUserID(in friendship: Friendship) -> UUID? {
        if friendship.requesterID == currentUserID {
            return friendship.addresseeID
        }
        if friendship.addresseeID == currentUserID {
            return friendship.requesterID
        }
        return nil
    }

    private func reloadSnapshot(
        expectedLifecycleGeneration: UInt64,
        expectedSurfaceLease: UInt64? = nil
    ) async throws {
        try requireCurrentLifecycle(
            expectedLifecycleGeneration,
            expectedSurfaceLease: expectedSurfaceLease
        )
        guard
            let cacheGeneration =
                await dependencies.cache.protectionGeneration(
                    for: currentUserID
                )
        else {
            throw CancellationError()
        }
        try requireCurrentLifecycle(
            expectedLifecycleGeneration,
            expectedSurfaceLease: expectedSurfaceLease
        )
        let loaded = try await dependencies.repository.fetchSocialSnapshot()
        try requireCurrentLifecycle(
            expectedLifecycleGeneration,
            expectedSurfaceLease: expectedSurfaceLease
        )
        let time = await dependencies.timeSource.now()
        try requireCurrentLifecycle(
            expectedLifecycleGeneration,
            expectedSurfaceLease: expectedSurfaceLease
        )
        guard
            await dependencies.cache.replace(
                loaded,
                at: time,
                ownedBy: currentUserID,
                ifGeneration: cacheGeneration
            )
        else {
            throw CancellationError()
        }
        try requireCurrentLifecycle(
            expectedLifecycleGeneration,
            expectedSurfaceLease: expectedSurfaceLease
        )
        guard
            await refreshFromCache(
                expectedLifecycleGeneration:
                    expectedLifecycleGeneration,
                expectedSurfaceLease: expectedSurfaceLease
            )
        else {
            throw CancellationError()
        }
        await synchronizeUnconfirmedPrivacyAction(
            using: loaded.profiles,
            expectedLifecycleGeneration:
                expectedLifecycleGeneration,
            expectedSurfaceLease: expectedSurfaceLease
        )
        try requireCurrentLifecycle(
            expectedLifecycleGeneration,
            expectedSurfaceLease: expectedSurfaceLease
        )
    }

    @discardableResult
    private func refreshFromCache(
        expectedLifecycleGeneration: UInt64? = nil,
        expectedSurfaceLease: UInt64? = nil,
        isMonitorRefresh: Bool = false
    ) async -> Bool {
        guard
            lifecycleMatches(
                expectedLifecycleGeneration,
                expectedSurfaceLease: expectedSurfaceLease
            )
        else {
            return false
        }
        let time = await dependencies.timeSource.now()
        guard
            lifecycleMatches(
                expectedLifecycleGeneration,
                expectedSurfaceLease: expectedSurfaceLease
            )
        else {
            return false
        }
        let refreshedSnapshot =
            await dependencies.cache.snapshot(
                at: time,
                ownedBy: currentUserID
            )
            ?? .empty
#if DEBUG
        if
            isMonitorRefresh,
            let expectedLifecycleGeneration
        {
            await pauseMonitorRefreshIfRequested(
                lifecycleGeneration:
                    expectedLifecycleGeneration
            )
        }
#endif
        guard
            lifecycleMatches(
                expectedLifecycleGeneration,
                expectedSurfaceLease: expectedSurfaceLease
            )
        else {
            return false
        }
        snapshot = refreshedSnapshot
        await synchronizeUnconfirmedPrivacyAction(
            using: snapshot.profiles,
            expectedLifecycleGeneration:
                expectedLifecycleGeneration,
            expectedSurfaceLease: expectedSurfaceLease
        )
        return lifecycleMatches(
            expectedLifecycleGeneration,
            expectedSurfaceLease: expectedSurfaceLease
        )
    }

    private func startCacheMonitor() {
        monitorTask?.cancel()
        guard let surfaceContext = activeSurfaceContext() else {
            return
        }
        monitorTask = Task { [weak self] in
            while !Task.isCancelled {
                let refreshed =
                    await self?.refreshFromCache(
                        expectedLifecycleGeneration:
                            surfaceContext.lifecycleGeneration,
                        expectedSurfaceLease: surfaceContext.lease,
                        isMonitorRefresh: true
                    ) == true
#if DEBUG
                await self?.recordMonitorRefreshCompletion(
                    lifecycleGeneration:
                        surfaceContext.lifecycleGeneration
                )
#endif
                guard refreshed
                else {
                    return
                }
                do {
                    try await Task.sleep(for: .seconds(1))
                } catch {
                    return
                }
            }
        }
    }

    private func loadPlaceNames() async {
        guard
            let loaded = try? await places.places(policy: .useCache).value
        else {
            return
        }
        placeNamesByID = Dictionary(
            uniqueKeysWithValues: loaded.map { ($0.id, $0.name) }
        )
    }

    private func performAndRefresh(
        _ action: () async throws -> Void
    ) async {
        guard let surfaceContext = activeSurfaceContext() else {
            return
        }
        let expectedGeneration =
            surfaceContext.lifecycleGeneration
        errorMessage = nil
        confirmationMessage = nil
        do {
            try await action()
            guard surfaceMatches(surfaceContext) else {
                return
            }
            confirmationMessage = "Change confirmed by the server."
        } catch {
            guard surfaceMatches(surfaceContext) else {
                return
            }
            errorMessage =
                "The server did not confirm that change. Please try again."
            return
        }
        do {
            try await reloadSnapshot(
                expectedLifecycleGeneration: expectedGeneration,
                expectedSurfaceLease: surfaceContext.lease
            )
        } catch is CancellationError {
            return
        } catch {
            guard surfaceMatches(surfaceContext) else {
                return
            }
            errorMessage =
                "The change was confirmed, but the latest Friends data could not be refreshed."
        }
    }

    private func performPrivacyAndRefresh(
        action failedAction: FailedPrivacyAction,
        _ action: () async throws -> Void
    ) async {
        guard let surfaceContext = activeSurfaceContext() else {
            return
        }
        let expectedGeneration =
            surfaceContext.lifecycleGeneration
        errorMessage = nil
        confirmationMessage = nil
        let expectedAction = failedAction.unconfirmedAction
        if
            let unresolved = await dependencies.writeCoordinator
                .currentUnconfirmedPrivacyAction(),
            unresolved != expectedAction
        {
            guard surfaceMatches(surfaceContext) else {
                return
            }
            await refreshFromCache(
                expectedLifecycleGeneration: expectedGeneration,
                expectedSurfaceLease: surfaceContext.lease
            )
            guard surfaceMatches(surfaceContext) else {
                return
            }
            errorMessage =
                "Another privacy change is still unconfirmed. Retry that exact action first."
            return
        }
        do {
            try await action()
            guard surfaceMatches(surfaceContext) else {
                return
            }
            failedPrivacyAction = nil
            confirmationMessage = "Privacy change confirmed by the server."
        } catch {
            guard surfaceMatches(surfaceContext) else {
                return
            }
            await refreshFromCache(
                expectedLifecycleGeneration: expectedGeneration,
                expectedSurfaceLease: surfaceContext.lease
            )
            guard surfaceMatches(surfaceContext) else {
                return
            }
            let unresolved = await dependencies.writeCoordinator
                .currentUnconfirmedPrivacyAction()
            guard surfaceMatches(surfaceContext) else {
                return
            }
            if unresolved == expectedAction {
                failedPrivacyAction = failedAction
                errorMessage =
                    "Hidden locally, but the server did not confirm the privacy change. Use Retry to repeat this exact action."
            } else if unresolved != nil {
                errorMessage =
                    "Another privacy change is still unconfirmed. Retry that exact action first."
            } else {
                errorMessage =
                    "The privacy change could not be completed. Please try again."
            }
            return
        }
        do {
            try await reloadSnapshot(
                expectedLifecycleGeneration: expectedGeneration,
                expectedSurfaceLease: surfaceContext.lease
            )
        } catch is CancellationError {
            return
        } catch {
            guard surfaceMatches(surfaceContext) else {
                return
            }
            errorMessage =
                "The privacy change was confirmed, but the latest Friends data could not be refreshed."
        }
    }

    private func synchronizeUnconfirmedPrivacyAction(
        using profiles: [SocialProfile],
        expectedLifecycleGeneration: UInt64? = nil,
        expectedSurfaceLease: UInt64? = nil
    ) async {
        guard
            lifecycleMatches(
                expectedLifecycleGeneration,
                expectedSurfaceLease: expectedSurfaceLease
            )
        else {
            return
        }
        let unresolved = await dependencies.writeCoordinator
            .currentUnconfirmedPrivacyAction()
        guard
            lifecycleMatches(
                expectedLifecycleGeneration,
                expectedSurfaceLease: expectedSurfaceLease
            )
        else {
            return
        }
        guard let unresolved else {
            failedPrivacyAction = nil
            return
        }

        let profileID: UUID
        let makeAction: (SocialProfile) -> FailedPrivacyAction
        switch unresolved {
        case let .revokePresenceShare(viewerID):
            profileID = viewerID
            makeAction = FailedPrivacyAction.revoke
        case let .removeFriend(otherUserID):
            profileID = otherUserID
            makeAction = FailedPrivacyAction.remove
        case let .blockUser(otherUserID):
            profileID = otherUserID
            makeAction = FailedPrivacyAction.block
        case .clearPresence, .setGhost:
            failedPrivacyAction = nil
            return
        }

        let retainedProfile: SocialProfile?
        switch failedPrivacyAction {
        case let .revoke(profile),
            let .remove(profile),
            let .block(profile)
            where profile.id == profileID:
            retainedProfile = profile
        default:
            retainedProfile = profiles.first { $0.id == profileID }
        }
        guard let retainedProfile else { return }
        failedPrivacyAction = makeAction(retainedProfile)
        if errorMessage == nil {
            errorMessage =
                "Hidden locally, but the server did not confirm the privacy change. Use Retry to repeat this exact action."
        }
    }

    private func requireCurrentLifecycle(
        _ expectedGeneration: UInt64,
        expectedSurfaceLease: UInt64? = nil
    ) throws {
        guard
            lifecycleMatches(
                expectedGeneration,
                expectedSurfaceLease: expectedSurfaceLease
            )
        else {
            throw CancellationError()
        }
    }

    private func lifecycleMatches(
        _ expectedGeneration: UInt64?,
        expectedSurfaceLease: UInt64? = nil
    ) -> Bool {
        if
            let expectedGeneration,
            lifecycleGeneration != expectedGeneration
        {
            return false
        }
        if
            let expectedSurfaceLease,
            surfaceLease != expectedSurfaceLease
        {
            return false
        }
        return true
    }

    private func activeSurfaceContext() -> ActiveSurfaceContext? {
        guard let surfaceLease else { return nil }
        return ActiveSurfaceContext(
            lifecycleGeneration: lifecycleGeneration,
            lease: surfaceLease
        )
    }

    private func surfaceMatches(
        _ context: ActiveSurfaceContext
    ) -> Bool {
        lifecycleMatches(
            context.lifecycleGeneration,
            expectedSurfaceLease: context.lease
        )
    }

#if DEBUG
    private func recordCoalescedActivation() {
        coalescedActivationCount += 1
        let matchingWaiterIDs =
            coalescedActivationCountWaiters.compactMap {
                waiterID, waiter in
                coalescedActivationCount >= waiter.count
                    ? waiterID
                    : nil
            }
        for waiterID in matchingWaiterIDs {
            coalescedActivationCountWaiters
                .removeValue(forKey: waiterID)?
                .continuation
                .resume(returning: true)
        }
    }

    private func awaitCoalescedActivationCount(
        _ count: Int,
        waiterID: UUID
    ) async -> Bool {
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                if coalescedActivationCount >= count {
                    continuation.resume(returning: true)
                } else if Task.isCancelled {
                    continuation.resume(returning: false)
                } else {
                    coalescedActivationCountWaiters[waiterID] =
                        CoalescedActivationWaiter(
                            count: count,
                            continuation: continuation
                        )
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                self?.cancelCoalescedActivationWaiter(
                    waiterID: waiterID
                )
            }
        }
    }

    private func cancelCoalescedActivationWaiter(
        waiterID: UUID
    ) {
        coalescedActivationCountWaiters
            .removeValue(forKey: waiterID)?
            .continuation
            .resume(returning: false)
    }

    private func pauseMonitorRefreshIfRequested(
        lifecycleGeneration: UInt64
    ) async {
        guard shouldGateNextMonitorRefresh else { return }
        shouldGateNextMonitorRefresh = false
        completedMonitorRefreshGenerations.remove(
            lifecycleGeneration
        )
        gatedMonitorRefreshGeneration = lifecycleGeneration
        let waiters = gatedMonitorRefreshWaiters
        gatedMonitorRefreshWaiters.removeAll()
        waiters.forEach {
            $0.resume(returning: lifecycleGeneration)
        }
        await withCheckedContinuation { continuation in
            gatedMonitorRefreshContinuation = continuation
        }
    }

    private func recordMonitorRefreshCompletion(
        lifecycleGeneration: UInt64
    ) {
        completedMonitorRefreshGenerations.insert(
            lifecycleGeneration
        )
        var remaining:
            [(UInt64, CheckedContinuation<Void, Never>)] = []
        for waiter in monitorRefreshCompletionWaiters {
            if waiter.0 == lifecycleGeneration {
                waiter.1.resume()
            } else {
                remaining.append(waiter)
            }
        }
        monitorRefreshCompletionWaiters = remaining
    }

    private func resumeActivationDeactivationCountWaiters() {
        var remaining:
            [(Int, CheckedContinuation<Void, Never>)] = []
        for waiter in activationDeactivationCountWaiters {
            if activationDeactivationWaiterCount >= waiter.0 {
                waiter.1.resume()
            } else {
                remaining.append(waiter)
            }
        }
        activationDeactivationCountWaiters = remaining
    }
#endif
}

struct FriendsView: View {
    @AccessibilityFocusState private var errorIsFocused: Bool
    @StateObject private var model: FriendsViewModel
    private let places: any PlaceRepository
    private let isSurfaceActive: Bool

    init(
        currentUserID: UUID,
        dependencies: SocialDependencies,
        places: any PlaceRepository,
        isSurfaceActive: Bool
    ) {
        self.places = places
        self.isSurfaceActive = isSurfaceActive
        _model = StateObject(
            wrappedValue: FriendsViewModel(
                currentUserID: currentUserID,
                dependencies: dependencies,
                places: places
            )
        )
    }

    var body: some View {
        List {
            if let errorMessage = model.errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                        .accessibilityLabel("Friends error. \(errorMessage)")
                        .accessibilityFocused($errorIsFocused)
                    if let failed = model.failedPrivacyAction {
                        Button(failed.label) {
                            Task {
                                await model.retryFailedPrivacyAction()
                            }
                        }
                        .accessibilityHint(
                            "Repeats only the exact unconfirmed privacy action."
                        )
                    }
                }
            }
            if let confirmationMessage = model.confirmationMessage {
                Section {
                    Label(
                        confirmationMessage,
                        systemImage: "checkmark.circle"
                    )
                    .foregroundStyle(.secondary)
                }
            }

            Section("Your presence") {
                NavigationLink {
                    PresenceView(
                        currentUserID: model.currentUserID,
                        dependencies: model.dependencies,
                        places: places
                    )
                } label: {
                    Label(
                        presenceSummary,
                        systemImage: "location.circle"
                    )
                }
                .accessibilityHint(
                    "Manage place-only presence and ghost mode."
                )
            }

            Section("Who can see me now") {
                if model.activeOutboundShares.isEmpty {
                    Text("No one has an active presence share.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.activeOutboundShares) { entry in
                        VStack(alignment: .leading) {
                            Text(entry.profile.displayName)
                            Text(
                                "Until \(entry.share.expiresAt.formatted(date: .abbreviated, time: .shortened))"
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }

            Section("Find a Brown friend") {
                TextField("Handle or name", text: $model.friendSearch)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel("Friend handle or name")
                ForEach(model.matchingProfiles) { profile in
                    Button {
                        Task { await model.requestFriend(profile) }
                    } label: {
                        HStack {
                            FriendAvatar(profile: profile)
                            VStack(alignment: .leading) {
                                Text(profile.displayName)
                                Text("@\(profile.handle)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("Add")
                        }
                    }
                    .accessibilityLabel("Add \(profile.displayName) as a friend")
                }
            }

            if !model.incomingProfiles.isEmpty {
                Section("Requests") {
                    ForEach(model.incomingProfiles) { profile in
                        VStack(alignment: .leading, spacing: 8) {
                            FriendIdentityRow(profile: profile)
                            HStack {
                                Button("Accept") {
                                    Task {
                                        await model.respond(
                                            to: profile,
                                            accept: true
                                        )
                                    }
                                }
                                .buttonStyle(.borderedProminent)
                                Button("Decline", role: .destructive) {
                                    Task {
                                        await model.respond(
                                            to: profile,
                                            accept: false
                                        )
                                    }
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }
                }
            }

            Section("Friends") {
                if model.isLoading {
                    ProgressView("Loading friends")
                } else if model.acceptedProfiles.isEmpty {
                    Text("No accepted friends yet.")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(model.acceptedProfiles) { profile in
                        NavigationLink {
                            FriendDetailView(
                                profile: profile,
                                model: model
                            )
                        } label: {
                            FriendIdentityRow(
                                profile: profile,
                                presence: model.presence(for: profile.id),
                                placeName: model.presence(for: profile.id)
                                    .flatMap(\.placeID)
                                    .map { model.placeName(for: $0) }
                            )
                        }
                    }
                }
            }

            if !model.blockedByMeProfiles.isEmpty {
                Section("Blocked by you") {
                    ForEach(model.blockedByMeProfiles) { profile in
                        HStack {
                            FriendIdentityRow(profile: profile)
                            Spacer()
                            Button("Unblock") {
                                Task { await model.unblock(profile) }
                            }
                            .disabled(
                                model.isPrivacyActionUnconfirmed(
                                    for: profile.id
                                )
                            )
                            .accessibilityLabel(
                                "Unblock \(profile.displayName)"
                            )
                        }
                    }
                }
            }

            if !model.outgoingProfiles.isEmpty {
                Section("Sent requests") {
                    ForEach(model.outgoingProfiles) { profile in
                        FriendIdentityRow(profile: profile)
                    }
                }
            }
        }
        .navigationTitle("Friends")
        .refreshable { await model.refresh() }
        .task(id: isSurfaceActive) {
            if isSurfaceActive {
                await model.activate()
            } else {
                await model.deactivate().value
            }
        }
        .onChange(of: model.errorMessage) {
            errorIsFocused = $0 != nil
        }
    }

    private var presenceSummary: String {
        guard
            let presence = model.presence(for: model.currentUserID),
            !presence.ghost,
            let placeID = presence.placeID
        else {
            return "Not sharing a place"
        }
        return "Sharing \(placeID.replacingOccurrences(of: "-", with: " "))"
    }
}

struct FriendIdentityRow: View {
    let profile: SocialProfile
    var presence: PresenceState? = nil
    var placeName: String? = nil

    var body: some View {
        HStack(spacing: 12) {
            FriendAvatar(profile: profile)
            VStack(alignment: .leading, spacing: 2) {
                Text(profile.displayName)
                    .font(.headline)
                Text("@\(profile.handle)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let placeName {
                    Label(
                        placeName,
                        systemImage: "location.fill"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct FriendAvatar: View {
    let profile: SocialProfile

    var body: some View {
        AsyncImage(url: profile.avatarURL) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            Image(systemName: "person.crop.circle.fill")
                .resizable()
                .foregroundStyle(.secondary)
        }
        .frame(width: 42, height: 42)
        .clipShape(Circle())
        .accessibilityHidden(true)
    }
}
