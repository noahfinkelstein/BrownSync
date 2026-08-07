import BrownSyncAPI
import Foundation

enum BoardNetworkPolicy {
    static func makeConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy =
            .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        return configuration
    }
}

struct NoopBoardLogSink: BoardLogSink {
    func record(_: BoardLogEvent) async {}
}

struct BoardSessionLeaseToken: Equatable, Sendable {
    fileprivate let ownerID: UUID
    fileprivate let generation: UInt64
}

struct BoardLoadRequest: Equatable, Sendable {
    let authState: AuthState
    let leaseToken: BoardSessionLeaseToken?
}

enum BoardSessionLeaseScope {
    @TaskLocal static var token: BoardSessionLeaseToken?
}

final class BoardSessionLease: @unchecked Sendable {
    private struct State {
        var ownerID: UUID?
        var generation: UInt64 = 0
    }

    private let lock = NSLock()
    private var state = State()

    @discardableResult
    func activate(userID: UUID) -> BoardSessionLeaseToken {
        withLock { state in
            if state.ownerID != userID {
                state.generation &+= 1
                state.ownerID = userID
            }
            return BoardSessionLeaseToken(
                ownerID: userID,
                generation: state.generation
            )
        }
    }

    func invalidate() {
        withLock { state in
            state.generation &+= 1
            state.ownerID = nil
        }
    }

    func token(for userID: UUID) -> BoardSessionLeaseToken? {
        withLock { state in
            guard state.ownerID == userID else {
                return nil
            }
            return BoardSessionLeaseToken(
                ownerID: userID,
                generation: state.generation
            )
        }
    }

    func isCurrent(_ token: BoardSessionLeaseToken) -> Bool {
        withLock { state in
            state.ownerID == token.ownerID
                && state.generation == token.generation
        }
    }

    func isCurrent(
        _ token: BoardSessionLeaseToken,
        for userID: UUID
    ) -> Bool {
        token.ownerID == userID && isCurrent(token)
    }

    private func withLock<Value>(
        _ operation: (inout State) -> Value
    ) -> Value {
        lock.lock()
        defer { lock.unlock() }
        return operation(&state)
    }
}

@MainActor
struct BoardDependencies {
    let networkSession: URLSession
    let lease: BoardSessionLease
    let cache: BoardMemoryCache
    let repository: WorkerBoardRepository
    let memberRepository: any BoardRepository
    let moderationRepository: any BoardModerationRepository
    let ownerRepository: any BoardOwnerRepository
    let memberModel: BoardViewModel
    let moderationModel: BoardModerationViewModel
    let ownerModel: BoardOwnerViewModel
    let lifecycle: BoardSessionLifecycle

    static func production(
        baseURL: URL,
        tokenProvider: any AccessTokenProviding
    ) -> BoardDependencies {
        let networkSession = URLSession(
            configuration: BoardNetworkPolicy.makeConfiguration()
        )
        let clients = WorkerAPIClients(
            baseURL: baseURL,
            tokenProvider: tokenProvider,
            urlSession: networkSession
        )
        return BoardDependencies(
            networkSession: networkSession,
            protectedClient: clients.protectedClient
        )
    }

    init(
        networkSession: URLSession,
        protectedClient: BrownSyncAPI.Client
    ) {
        let lease = BoardSessionLease()
        let cache = BoardMemoryCache(lease: lease)
        let repository = WorkerBoardRepository(
            client: protectedClient,
            cache: cache,
            logger: NoopBoardLogSink(),
            lease: lease
        )
        let memberModel = BoardViewModel(
            repository: repository,
            cache: cache,
            requestIDs: SystemUUIDProvider(),
            lease: lease
        )
        let moderationModel = BoardModerationViewModel(
            repository: repository,
            cache: cache,
            requestIDs: SystemUUIDProvider(),
            lease: lease
        )
        let ownerModel = BoardOwnerViewModel(
            repository: repository,
            cache: cache,
            lease: lease
        )

        self.networkSession = networkSession
        self.lease = lease
        self.cache = cache
        self.repository = repository
        memberRepository = repository
        moderationRepository = repository
        ownerRepository = repository
        self.memberModel = memberModel
        self.moderationModel = moderationModel
        self.ownerModel = ownerModel
        lifecycle = BoardSessionLifecycle(
            cache: cache,
            member: memberModel,
            moderation: moderationModel,
            owner: ownerModel,
            lease: lease
        )
    }
}

@MainActor
final class BoardSessionLifecycle: SensitiveCachePurging {
    private struct ModelGenerations: Sendable {
        let member: UInt64
        let moderation: UInt64
        let owner: UInt64
    }

    private let cache: BoardMemoryCache
    private let member: BoardViewModel
    private let moderation: BoardModerationViewModel
    private let owner: BoardOwnerViewModel
    private let lease: BoardSessionLease?
    private var tail: Task<Void, Never>?
    private var admittedUserID: UUID?
    private var isForeground = false
    private var activationGeneration: UInt64 = 0

    init(
        cache: BoardMemoryCache,
        member: BoardViewModel,
        moderation: BoardModerationViewModel,
        owner: BoardOwnerViewModel,
        lease: BoardSessionLease? = nil
    ) {
        self.cache = cache
        self.member = member
        self.moderation = moderation
        self.owner = owner
        self.lease = lease
    }

    func activate(userID: UUID) async {
        if let admittedUserID, admittedUserID != userID {
            self.admittedUserID = nil
            activationGeneration &+= 1
            await enqueue(.authExpired).value
        }
        admittedUserID = userID
        activationGeneration &+= 1
        await openLeaseIfCurrent(
            userID: userID,
            generation: activationGeneration
        )
    }

    func activateForeground(userID: UUID) async {
        isForeground = true
        guard admittedUserID == userID else {
            return
        }
        activationGeneration &+= 1
        await openLeaseIfCurrent(
            userID: userID,
            generation: activationGeneration
        )
    }

    func enqueueSceneBackground() {
        isForeground = false
        activationGeneration &+= 1
        _ = enqueue(.sceneBackgrounded)
    }

    func purge(reason: SensitiveCachePurgeReason) async {
        guard let event = BoardLifecycleEvent(reason) else {
            return
        }
        switch event {
        case .sceneBackgrounded:
            isForeground = false
        case .authExpired, .signedOut, .accountDeleted:
            admittedUserID = nil
        }
        activationGeneration &+= 1
        await enqueue(event).value
    }

    func waitForIdle() async {
        await tail?.value
    }

    private func openLeaseIfCurrent(
        userID: UUID,
        generation: UInt64
    ) async {
        await tail?.value
        guard
            generation == activationGeneration,
            isForeground,
            admittedUserID == userID
        else {
            return
        }
        lease?.activate(userID: userID)
    }

    private func enqueue(
        _ event: BoardLifecycleEvent
    ) -> Task<Void, Never> {
        lease?.invalidate()
        let generations = ModelGenerations(
            member: member.beginLifecycleInvalidation(),
            moderation: moderation.beginLifecycleInvalidation(),
            owner: owner.beginLifecycleInvalidation()
        )
        let previous = tail
        let operation = Task { @MainActor [weak self] in
            await previous?.value
            guard let self else {
                return
            }
            await cache.purge(reason: event.cachePurgeReason)
            member.completeLifecycleInvalidation(
                generation: generations.member
            )
            moderation.completeLifecycleInvalidation(
                generation: generations.moderation
            )
            owner.completeLifecycleInvalidation(
                generation: generations.owner
            )
        }
        tail = operation
        return operation
    }
}

extension BoardLifecycleEvent {
    fileprivate init?(_ reason: SensitiveCachePurgeReason) {
        switch reason {
        case .sceneBackgrounded:
            self = .sceneBackgrounded
        case .authExpired:
            self = .authExpired
        case .signedOut:
            self = .signedOut
        case .accountDeleted:
            self = .accountDeleted
        case .shareRevoked, .ghostEnabled, .presenceCleared,
            .presenceExpired:
            return nil
        }
    }

    var cachePurgeReason: BoardCachePurgeReason {
        switch self {
        case .sceneBackgrounded:
            return .sceneBackgrounded
        case .authExpired:
            return .authExpired
        case .signedOut:
            return .signedOut
        case .accountDeleted:
            return .accountDeleted
        }
    }
}
