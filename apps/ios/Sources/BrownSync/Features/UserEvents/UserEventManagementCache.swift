import Foundation

struct UserEventManagementCacheSnapshot: Equatable, Sendable {
    let events: [ManagedUserEvent]

    static let empty = UserEventManagementCacheSnapshot(events: [])
}

struct UserEventManagementCacheProtection: Equatable, Sendable {
    let ownerID: UUID
    let generation: UInt64
}

struct UserEventManagementCacheLoadProtection: Equatable, Sendable {
    let ownerID: UUID
    let cacheGeneration: UInt64
    let loadGeneration: UInt64
}

actor UserEventManagementCache: SensitiveCachePurging {
    private var ownerID: UUID?
    private var generation: UInt64 = 0
    private var loadGeneration: UInt64 = 0
    private var storedSnapshot: UserEventManagementCacheSnapshot = .empty

    func activate(
        ownerID: UUID
    ) -> UserEventManagementCacheProtection {
        generation &+= 1
        loadGeneration &+= 1
        self.ownerID = ownerID
        storedSnapshot = .empty
        return UserEventManagementCacheProtection(
            ownerID: ownerID,
            generation: generation
        )
    }

    func beginLoad(
        protection: UserEventManagementCacheProtection
    ) -> UserEventManagementCacheLoadProtection? {
        guard matches(protection) else { return nil }
        loadGeneration &+= 1
        return UserEventManagementCacheLoadProtection(
            ownerID: protection.ownerID,
            cacheGeneration: protection.generation,
            loadGeneration: loadGeneration
        )
    }

    func replaceEvents(_ events: [ManagedUserEvent]) {
        storedSnapshot = UserEventManagementCacheSnapshot(events: events)
    }

    @discardableResult
    func replaceEvents(
        _ events: [ManagedUserEvent],
        protection: UserEventManagementCacheProtection
    ) -> Bool {
        guard matches(protection) else { return false }
        replaceEvents(events)
        return true
    }

    @discardableResult
    func replaceEvents(
        _ events: [ManagedUserEvent],
        loadProtection: UserEventManagementCacheLoadProtection
    ) -> Bool {
        guard matches(loadProtection) else { return false }
        replaceEvents(events)
        return true
    }

    func upsert(_ event: ManagedUserEvent) {
        var events = storedSnapshot.events
        if let index = events.firstIndex(where: { $0.id == event.id }) {
            events[index] = event
        } else {
            events.insert(event, at: 0)
        }
        storedSnapshot = UserEventManagementCacheSnapshot(events: events)
    }

    @discardableResult
    func upsert(
        _ event: ManagedUserEvent,
        protection: UserEventManagementCacheProtection
    ) -> Bool {
        guard matches(protection) else { return false }
        upsert(event)
        return true
    }

    func remove(eventID: UUID) {
        storedSnapshot = UserEventManagementCacheSnapshot(
            events: storedSnapshot.events.filter { $0.id != eventID }
        )
    }

    @discardableResult
    func remove(
        eventID: UUID,
        protection: UserEventManagementCacheProtection
    ) -> Bool {
        guard matches(protection) else { return false }
        remove(eventID: eventID)
        return true
    }

    func snapshot() -> UserEventManagementCacheSnapshot {
        storedSnapshot
    }

    func purge(reason: SensitiveCachePurgeReason) async {
        guard reason.invalidatesUserEventManagement else { return }
        invalidate()
    }

    func purgeOnNavigationExit() {
        invalidate()
    }

    private func invalidate() {
        generation &+= 1
        loadGeneration &+= 1
        ownerID = nil
        storedSnapshot = .empty
    }

    private func matches(
        _ protection: UserEventManagementCacheProtection
    ) -> Bool {
        ownerID == protection.ownerID
            && generation == protection.generation
    }

    private func matches(
        _ protection: UserEventManagementCacheLoadProtection
    ) -> Bool {
        ownerID == protection.ownerID
            && generation == protection.cacheGeneration
            && loadGeneration == protection.loadGeneration
    }
}

extension SensitiveCachePurgeReason {
    fileprivate var invalidatesUserEventManagement: Bool {
        switch self {
        case .signedOut, .authExpired, .accountDeleted,
            .sceneBackgrounded:
            return true
        case .shareRevoked(_), .ghostEnabled, .presenceCleared,
            .presenceExpired(_):
            return false
        }
    }
}
