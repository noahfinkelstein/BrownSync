import Foundation

struct OrganizationOwnershipCacheSnapshot: Equatable, Sendable {
    let access: OrganizationAccessSnapshot?
    let reviewClaims: [OrganizationReviewableClaim]

    static let empty = OrganizationOwnershipCacheSnapshot(
        access: nil,
        reviewClaims: []
    )
}

struct OrganizationOwnershipCacheProtection: Equatable, Sendable {
    let ownerID: UUID
    let generation: UInt64
}

struct OrganizationOwnershipReviewProtection: Equatable, Sendable {
    let ownerID: UUID
    let sessionGeneration: UInt64
    let reviewGeneration: UInt64
}

actor OrganizationOwnershipCache: SensitiveCachePurging {
    private var ownerID: UUID?
    private var protectionGeneration: UInt64 = 0
    private var reviewProtectionGeneration: UInt64 = 0
    private var storedSnapshot: OrganizationOwnershipCacheSnapshot = .empty

    func activate(
        ownerID: UUID
    ) -> OrganizationOwnershipCacheProtection {
        protectionGeneration &+= 1
        reviewProtectionGeneration &+= 1
        self.ownerID = ownerID
        storedSnapshot = .empty
        return OrganizationOwnershipCacheProtection(
            ownerID: ownerID,
            generation: protectionGeneration
        )
    }

    func protection(
        for ownerID: UUID
    ) -> OrganizationOwnershipCacheProtection? {
        guard self.ownerID == ownerID else { return nil }
        return OrganizationOwnershipCacheProtection(
            ownerID: ownerID,
            generation: protectionGeneration
        )
    }

    func beginReview(
        ownedBy ownerID: UUID,
        ifGeneration expectedGeneration: UInt64
    ) -> OrganizationOwnershipReviewProtection? {
        guard
            self.ownerID == ownerID,
            protectionGeneration == expectedGeneration
        else {
            return nil
        }
        reviewProtectionGeneration &+= 1
        storedSnapshot = OrganizationOwnershipCacheSnapshot(
            access: storedSnapshot.access,
            reviewClaims: []
        )
        return OrganizationOwnershipReviewProtection(
            ownerID: ownerID,
            sessionGeneration: protectionGeneration,
            reviewGeneration: reviewProtectionGeneration
        )
    }

    func replaceAccess(_ access: OrganizationAccessSnapshot) {
        storedSnapshot = OrganizationOwnershipCacheSnapshot(
            access: access,
            reviewClaims: storedSnapshot.reviewClaims
        )
    }

    @discardableResult
    func replaceAccess(
        _ access: OrganizationAccessSnapshot,
        protection: OrganizationOwnershipCacheProtection
    ) -> Bool {
        guard sessionMatches(protection) else { return false }
        replaceAccess(access)
        return true
    }

    func replaceReviewClaims(
        _ claims: [OrganizationReviewableClaim]
    ) {
        storedSnapshot = OrganizationOwnershipCacheSnapshot(
            access: storedSnapshot.access,
            reviewClaims: claims
        )
    }

    @discardableResult
    func replaceReviewClaims(
        _ claims: [OrganizationReviewableClaim],
        protection: OrganizationOwnershipReviewProtection
    ) -> Bool {
        guard reviewMatches(protection) else { return false }
        replaceReviewClaims(claims)
        return true
    }

    @discardableResult
    func appendReviewClaims(
        _ claims: [OrganizationReviewableClaim],
        protection: OrganizationOwnershipReviewProtection
    ) -> Bool {
        guard reviewMatches(protection) else { return false }
        storedSnapshot = OrganizationOwnershipCacheSnapshot(
            access: storedSnapshot.access,
            reviewClaims: storedSnapshot.reviewClaims + claims
        )
        return true
    }

    func removeReviewClaim(id: UUID) {
        storedSnapshot = OrganizationOwnershipCacheSnapshot(
            access: storedSnapshot.access,
            reviewClaims: storedSnapshot.reviewClaims.filter {
                $0.claimID != id
            }
        )
    }

    @discardableResult
    func removeReviewClaim(
        id: UUID,
        protection: OrganizationOwnershipReviewProtection
    ) -> Bool {
        guard reviewMatches(protection) else { return false }
        removeReviewClaim(id: id)
        return true
    }

    func snapshot() -> OrganizationOwnershipCacheSnapshot {
        storedSnapshot
    }

    func snapshot(
        protection: OrganizationOwnershipCacheProtection
    ) -> OrganizationOwnershipCacheSnapshot? {
        guard sessionMatches(protection) else { return nil }
        return storedSnapshot
    }

    func purge(reason: SensitiveCachePurgeReason) async {
        guard reason.invalidatesOrganizationOwnership else { return }
        invalidateAll()
    }

    @discardableResult
    func purge(
        reason: SensitiveCachePurgeReason,
        protection: OrganizationOwnershipCacheProtection
    ) -> Bool {
        guard
            reason.invalidatesOrganizationOwnership,
            sessionMatches(protection)
        else {
            return false
        }
        invalidateAll()
        return true
    }

    func purgeOnNavigationExit() {
        invalidateAll()
    }

    @discardableResult
    func purgeOnNavigationExit(
        protection: OrganizationOwnershipCacheProtection
    ) -> Bool {
        guard sessionMatches(protection) else { return false }
        invalidateAll()
        return true
    }

    @discardableResult
    func purgeReviewOnNavigationExit(
        protection: OrganizationOwnershipReviewProtection
    ) -> Bool {
        guard reviewMatches(protection) else { return false }
        reviewProtectionGeneration &+= 1
        storedSnapshot = OrganizationOwnershipCacheSnapshot(
            access: storedSnapshot.access,
            reviewClaims: []
        )
        return true
    }

    private func invalidateAll() {
        protectionGeneration &+= 1
        reviewProtectionGeneration &+= 1
        ownerID = nil
        storedSnapshot = .empty
    }

    private func sessionMatches(
        _ protection: OrganizationOwnershipCacheProtection
    ) -> Bool {
        ownerID == protection.ownerID
            && protectionGeneration == protection.generation
    }

    private func reviewMatches(
        _ protection: OrganizationOwnershipReviewProtection
    ) -> Bool {
        ownerID == protection.ownerID
            && protectionGeneration == protection.sessionGeneration
            && reviewProtectionGeneration
                == protection.reviewGeneration
    }
}

private extension SensitiveCachePurgeReason {
    var invalidatesOrganizationOwnership: Bool {
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
