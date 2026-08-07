import Foundation

actor SensitiveCache: SensitiveCachePurging {
    private var currentUserID: UUID?
    private let maximumFriendPresenceStaleness: Duration
    private var storedSnapshot: SocialSnapshot = .empty
    private var presenceFetchedAt: Duration?
    private var protectionGeneration: UInt64 = 0
    private var privacySessionEpoch: UInt64 = 0
    private var unconfirmedPrivacyAction: UnconfirmedPrivacyAction?
#if DEBUG
    private let beforePurge:
        (@Sendable (SensitiveCachePurgeReason) async -> Void)?
#endif

    init(
        currentUserID: UUID?,
        maximumFriendPresenceStaleness: Duration = .seconds(60)
    ) {
        self.currentUserID = currentUserID
        self.maximumFriendPresenceStaleness =
            maximumFriendPresenceStaleness
#if DEBUG
        beforePurge = nil
#endif
    }

#if DEBUG
    init(
        currentUserID: UUID?,
        maximumFriendPresenceStaleness: Duration = .seconds(60),
        beforePurge:
            @escaping @Sendable
            (SensitiveCachePurgeReason) async -> Void
    ) {
        self.currentUserID = currentUserID
        self.maximumFriendPresenceStaleness =
            maximumFriendPresenceStaleness
        self.beforePurge = beforePurge
    }
#endif

    func setCurrentUserID(_ userID: UUID) {
        guard currentUserID != userID else { return }
        currentUserID = userID
        protectionGeneration &+= 1
        privacySessionEpoch &+= 1
        unconfirmedPrivacyAction = nil
        storedSnapshot = .empty
        presenceFetchedAt = nil
    }

    func currentPrivacySessionEpoch() -> UInt64 {
        privacySessionEpoch
    }

    func currentProtectionGeneration() -> UInt64 {
        protectionGeneration
    }

    func protectionGeneration(for userID: UUID) -> UInt64? {
        guard currentUserID == userID else { return nil }
        return protectionGeneration
    }

    func replace(_ snapshot: SocialSnapshot, at time: PresenceTime) {
        storedSnapshot = redactingUnconfirmedPrivacy(from: snapshot)
        presenceFetchedAt = time.monotonic
        removeExpiredPresence(at: time)
    }

    @discardableResult
    func replace(
        _ snapshot: SocialSnapshot,
        at time: PresenceTime,
        ownedBy userID: UUID,
        ifGeneration expectedGeneration: UInt64
    ) -> Bool {
        guard
            currentUserID == userID,
            protectionGeneration == expectedGeneration
        else {
            return false
        }
        replace(snapshot, at: time)
        return true
    }

    func replaceVisiblePresence(
        _ presence: [PresenceState],
        at time: PresenceTime
    ) {
        storedSnapshot = redactingUnconfirmedPrivacy(
            from: SocialSnapshot(
            profiles: storedSnapshot.profiles,
            friendships: storedSnapshot.friendships,
            shares: storedSnapshot.shares,
            presence: presence
            )
        )
        presenceFetchedAt = time.monotonic
        removeExpiredPresence(at: time)
    }

    @discardableResult
    func replaceVisiblePresence(
        _ presence: [PresenceState],
        at time: PresenceTime,
        ifGeneration expectedGeneration: UInt64
    ) -> Bool {
        guard protectionGeneration == expectedGeneration else {
            return false
        }
        replaceVisiblePresence(presence, at: time)
        return true
    }

    func snapshot(at time: PresenceTime) -> SocialSnapshot {
        removeExpiredPresence(at: time)
        return storedSnapshot
    }

    func snapshot(
        at time: PresenceTime,
        ownedBy userID: UUID
    ) -> SocialSnapshot? {
        guard currentUserID == userID else { return nil }
        removeExpiredPresence(at: time)
        return storedSnapshot
    }

    func visiblePresence(at time: PresenceTime) -> [PresenceState] {
        removeExpiredPresence(at: time)
        return storedSnapshot.presence
    }

    func nextPresenceExpiry() -> Date? {
        storedSnapshot.presence.compactMap { row in
            let isOwnGhostSentinel =
                row.ghost
                    && (currentUserID.map { $0 == row.userID } ?? false)
            return isOwnGhostSentinel ? nil : row.expiresAt
        }.min()
    }

    func purge(reason: SensitiveCachePurgeReason) async {
#if DEBUG
        await beforePurge?(reason)
#endif
        protectionGeneration &+= 1
        applyPurge(reason: reason)
    }

    @discardableResult
    func purge(
        reason: SensitiveCachePurgeReason,
        ifPrivacySessionEpoch expectedEpoch: UInt64
    ) -> Bool {
        guard privacySessionEpoch == expectedEpoch else { return false }
        protectionGeneration &+= 1
        applyPurge(reason: reason)
        return true
    }

    @discardableResult
    func purge(
        reason: SensitiveCachePurgeReason,
        ownedBy userID: UUID
    ) -> Bool {
        guard currentUserID == userID else { return false }
        protectionGeneration &+= 1
        applyPurge(reason: reason)
        return true
    }

    private func applyPurge(reason: SensitiveCachePurgeReason) {
        switch reason {
        case .signedOut, .authExpired, .accountDeleted:
            currentUserID = nil
            privacySessionEpoch &+= 1
            unconfirmedPrivacyAction = nil
            storedSnapshot = .empty
            presenceFetchedAt = nil
        case .sceneBackgrounded:
            storedSnapshot = .empty
            presenceFetchedAt = nil
        case let .shareRevoked(viewerID):
            storedSnapshot = replacing(
                shares: storedSnapshot.shares.filter { share in
                    !(
                        currentUserID.map {
                            $0 == share.ownerID
                        } ?? false
                            && share.viewerID == viewerID
                    )
                }
            )
        case .ghostEnabled, .presenceCleared:
            storedSnapshot = replacing(
                presence: storedSnapshot.presence.filter {
                    $0.userID != currentUserID
                }
            )
        case let .presenceExpired(userID):
            storedSnapshot = replacing(
                presence: storedSnapshot.presence.filter {
                    $0.userID != userID
                }
            )
        }
    }

    func setUnconfirmedPrivacyAction(
        _ action: UnconfirmedPrivacyAction,
        ifPrivacySessionEpoch expectedEpoch: UInt64
    ) -> UInt64? {
        guard privacySessionEpoch == expectedEpoch else { return nil }
        protectionGeneration &+= 1
        unconfirmedPrivacyAction = action
        storedSnapshot = redactingUnconfirmedPrivacy(
            from: storedSnapshot
        )
        return protectionGeneration
    }

    func clearUnconfirmedPrivacyAction(
        _ action: UnconfirmedPrivacyAction,
        ifPrivacySessionEpoch expectedEpoch: UInt64
    ) {
        guard
            privacySessionEpoch == expectedEpoch,
            unconfirmedPrivacyAction == action
        else {
            return
        }
        protectionGeneration &+= 1
        unconfirmedPrivacyAction = nil
    }

    func resetUnconfirmedPrivacyAction() {
        protectionGeneration &+= 1
        privacySessionEpoch &+= 1
        unconfirmedPrivacyAction = nil
    }

    @discardableResult
    func retainConfirmedGhostSentinel(
        at time: PresenceTime,
        ifPrivacySessionEpoch expectedEpoch: UInt64,
        ifProtectionGeneration expectedGeneration: UInt64
    ) -> Bool {
        guard
            privacySessionEpoch == expectedEpoch,
            protectionGeneration == expectedGeneration,
            let currentUserID
        else {
            return false
        }
        protectionGeneration &+= 1
        let sentinel = PresenceState(
            userID: currentUserID,
            placeID: nil,
            status: nil,
            note: nil,
            ghost: true,
            updatedAt: time.wallClock,
            expiresAt: time.wallClock
        )
        storedSnapshot = replacing(
            presence: storedSnapshot.presence.filter {
                $0.userID != currentUserID
            } + [sentinel]
        )
        return true
    }

    @discardableResult
    func removeConnection(
        with userID: UUID,
        ifPrivacySessionEpoch expectedEpoch: UInt64
    ) -> Bool {
        guard privacySessionEpoch == expectedEpoch else { return false }
        protectionGeneration &+= 1
        storedSnapshot = SocialSnapshot(
            profiles: storedSnapshot.profiles.filter { $0.id != userID },
            friendships: storedSnapshot.friendships.filter {
                $0.requesterID != userID && $0.addresseeID != userID
            },
            shares: storedSnapshot.shares.filter {
                $0.ownerID != userID && $0.viewerID != userID
            },
            presence: storedSnapshot.presence.filter {
                $0.userID != userID
            }
        )
        return true
    }

    func purgeVisibleFriendPresence() {
        protectionGeneration &+= 1
        storedSnapshot = replacing(
            presence: storedSnapshot.presence.filter { row in
                currentUserID.map { $0 == row.userID } ?? false
            }
        )
        presenceFetchedAt = nil
    }

    private func removeExpiredPresence(at time: PresenceTime) {
        let friendRowsAreStale: Bool
        if let presenceFetchedAt {
            friendRowsAreStale =
                time.monotonic
                >= presenceFetchedAt + maximumFriendPresenceStaleness
        } else {
            friendRowsAreStale = true
        }

        storedSnapshot = replacing(
            presence: storedSnapshot.presence.filter { row in
                let isCurrentUser =
                    currentUserID.map { $0 == row.userID } ?? false
                if isCurrentUser && row.ghost {
                    // `set_ghost(true)` persists a durable own-row sentinel
                    // whose expiry equals its write time. Keep the privacy
                    // state so a reopened surface can reliably turn it off,
                    // while all UI continues to suppress its place.
                    return true
                }
                guard row.expiresAt > time.wallClock else { return false }
                return isCurrentUser || !friendRowsAreStale
            }
        )
    }

    private func replacing(
        profiles: [SocialProfile]? = nil,
        friendships: [Friendship]? = nil,
        shares: [PresenceShare]? = nil,
        presence: [PresenceState]? = nil
    ) -> SocialSnapshot {
        SocialSnapshot(
            profiles: profiles ?? storedSnapshot.profiles,
            friendships: friendships ?? storedSnapshot.friendships,
            shares: shares ?? storedSnapshot.shares,
            presence: presence ?? storedSnapshot.presence
        )
    }

    private func redactingUnconfirmedPrivacy(
        from snapshot: SocialSnapshot
    ) -> SocialSnapshot {
        guard let unconfirmedPrivacyAction else { return snapshot }
        switch unconfirmedPrivacyAction {
        case .clearPresence, .setGhost:
            return SocialSnapshot(
                profiles: snapshot.profiles,
                friendships: snapshot.friendships,
                shares: snapshot.shares,
                presence: snapshot.presence.filter { row in
                    currentUserID.map { $0 != row.userID } ?? true
                }
            )
        case let .revokePresenceShare(viewerID):
            return SocialSnapshot(
                profiles: snapshot.profiles,
                friendships: snapshot.friendships,
                shares: snapshot.shares.filter { share in
                    !(
                        (currentUserID.map {
                            $0 == share.ownerID
                        } ?? false)
                            && share.viewerID == viewerID
                    )
                },
                presence: snapshot.presence
            )
        case let .blockUser(otherUserID),
            let .removeFriend(otherUserID):
            return SocialSnapshot(
                profiles: snapshot.profiles.filter {
                    $0.id != otherUserID
                },
                friendships: snapshot.friendships.filter {
                    $0.requesterID != otherUserID
                        && $0.addresseeID != otherUserID
                },
                shares: snapshot.shares.filter {
                    $0.ownerID != otherUserID
                        && $0.viewerID != otherUserID
                },
                presence: snapshot.presence.filter {
                    $0.userID != otherUserID
                }
            )
        }
    }
}
