import Foundation

enum BoardCachePurgeReason: Equatable, Sendable {
    case mutation(BoardMutationKind)
    case sceneBackgrounded
    case authExpired
    case signedOut
    case accountDeleted
}

enum BoardMutationKind: CaseIterable, Equatable, Hashable, Sendable {
    case createPost
    case editPost
    case deletePost
    case createComment
    case editComment
    case deleteComment
    case vote
    case report
    case appealContent
    case appealBan
    case moderationDecision
    case createBan
    case revokeBan
    case appealDecision
    case updateConfig
    case upsertModerator
    case removeModerator
}

enum BoardCachePartition: Equatable, Sendable {
    case member
    case moderation
    case owner
}

struct BoardCacheWriteToken: Equatable, Sendable {
    fileprivate let partition: BoardCachePartition
    fileprivate let generation: UInt64
    fileprivate let leaseToken: BoardSessionLeaseToken?
}

struct BoardCacheSnapshot: Equatable, Sendable {
    let status: BoardStatus?
    let feed: BoardFeedPage?
    let thread: BoardThreadPage?
    let ownContent: BoardOwnContentPage?
    let moderationQueue: BoardModerationQueuePage?
    let config: BoardConfig?
    let moderators: BoardModeratorPage?

    static let empty = BoardCacheSnapshot(
        status: nil,
        feed: nil,
        thread: nil,
        ownContent: nil,
        moderationQueue: nil,
        config: nil,
        moderators: nil
    )
}

actor BoardMemoryCache {
    private let lease: BoardSessionLease?
    private var status: BoardStatus?
    private var feed: BoardFeedPage?
    private var thread: BoardThreadPage?
    private var ownContent: BoardOwnContentPage?
    private var moderationQueue: BoardModerationQueuePage?
    private var config: BoardConfig?
    private var moderators: BoardModeratorPage?
    private var memberGeneration: UInt64 = 0
    private var moderationGeneration: UInt64 = 0
    private var ownerGeneration: UInt64 = 0

    init(lease: BoardSessionLease? = nil) {
        self.lease = lease
    }

    func snapshot() -> BoardCacheSnapshot {
        BoardCacheSnapshot(
            status: status,
            feed: feed,
            thread: thread,
            ownContent: ownContent,
            moderationQueue: moderationQueue,
            config: config,
            moderators: moderators
        )
    }

    func replaceStatus(_ value: BoardStatus) {
        status = value
    }

    @discardableResult
    func replaceStatus(
        _ value: BoardStatus,
        ifCurrent token: BoardCacheWriteToken
    ) -> Bool {
        guard isCurrent(token, for: .member) else {
            return false
        }
        status = value
        return true
    }

    func replaceFeed(_ value: BoardFeedPage) {
        feed = value
    }

    @discardableResult
    func replaceFeed(
        _ value: BoardFeedPage,
        ifCurrent token: BoardCacheWriteToken
    ) -> Bool {
        guard isCurrent(token, for: .member) else {
            return false
        }
        feed = value
        return true
    }

    func replaceThread(_ value: BoardThreadPage) {
        thread = value
    }

    @discardableResult
    func replaceThread(
        _ value: BoardThreadPage,
        ifCurrent token: BoardCacheWriteToken
    ) -> Bool {
        guard isCurrent(token, for: .member) else {
            return false
        }
        thread = value
        return true
    }

    func replaceOwnContent(_ value: BoardOwnContentPage) {
        ownContent = value
    }

    @discardableResult
    func replaceOwnContent(
        _ value: BoardOwnContentPage,
        ifCurrent token: BoardCacheWriteToken
    ) -> Bool {
        guard isCurrent(token, for: .member) else {
            return false
        }
        ownContent = value
        return true
    }

    func replaceModerationQueue(_ value: BoardModerationQueuePage) {
        moderationQueue = value
    }

    @discardableResult
    func replaceModerationQueue(
        _ value: BoardModerationQueuePage,
        ifCurrent token: BoardCacheWriteToken
    ) -> Bool {
        guard isCurrent(token, for: .moderation) else {
            return false
        }
        moderationQueue = value
        return true
    }

    func replaceConfig(_ value: BoardConfig) {
        config = value
    }

    @discardableResult
    func replaceConfig(
        _ value: BoardConfig,
        ifCurrent token: BoardCacheWriteToken
    ) -> Bool {
        guard isCurrent(token, for: .owner) else {
            return false
        }
        config = value
        return true
    }

    func replaceModerators(_ value: BoardModeratorPage) {
        moderators = value
    }

    @discardableResult
    func replaceModerators(
        _ value: BoardModeratorPage,
        ifCurrent token: BoardCacheWriteToken
    ) -> Bool {
        guard isCurrent(token, for: .owner) else {
            return false
        }
        moderators = value
        return true
    }

    func writeToken(
        for partition: BoardCachePartition
    ) -> BoardCacheWriteToken {
        BoardCacheWriteToken(
            partition: partition,
            generation: generation(for: partition),
            leaseToken: BoardSessionLeaseScope.token
        )
    }

    func purge(reason _: BoardCachePurgeReason) {
        purgeAll()
    }

    func purgeMemberPartition() {
        memberGeneration &+= 1
        status = nil
        feed = nil
        thread = nil
        ownContent = nil
    }

    func purgeModerationPartition() {
        moderationGeneration &+= 1
        moderationQueue = nil
    }

    func purgeOwnerPartition() {
        ownerGeneration &+= 1
        config = nil
        moderators = nil
    }

    private func purgeAll() {
        memberGeneration &+= 1
        moderationGeneration &+= 1
        ownerGeneration &+= 1
        status = nil
        feed = nil
        thread = nil
        ownContent = nil
        moderationQueue = nil
        config = nil
        moderators = nil
    }

    private func generation(
        for partition: BoardCachePartition
    ) -> UInt64 {
        switch partition {
        case .member:
            return memberGeneration
        case .moderation:
            return moderationGeneration
        case .owner:
            return ownerGeneration
        }
    }

    private func isCurrent(
        _ token: BoardCacheWriteToken,
        for partition: BoardCachePartition
    ) -> Bool {
        guard
            token.partition == partition,
            token.generation == generation(for: partition)
        else {
            return false
        }
        guard let lease else {
            return true
        }
        guard let leaseToken = token.leaseToken else {
            return false
        }
        return lease.isCurrent(leaseToken)
    }
}

extension BoardMemoryCache: SensitiveCachePurging {
    func purge(reason _: SensitiveCachePurgeReason) async {
        purgeAll()
    }
}
