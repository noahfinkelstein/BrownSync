import Combine
import Foundation

@MainActor
final class BoardViewModel: ObservableObject {
    @Published private(set) var state: BoardScreenState =
        .authenticationRequired

    private let repository: any BoardRepository
    private let cache: BoardMemoryCache
    private let requestIDs: any UUIDProviding
    private let lease: BoardSessionLease?
    private var lifecycleGeneration: UInt64 = 0
    private var paginationGeneration: UInt64?
    private var activeLeaseToken: BoardSessionLeaseToken?

    init(
        repository: any BoardRepository,
        cache: BoardMemoryCache,
        requestIDs: any UUIDProviding,
        lease: BoardSessionLease? = nil
    ) {
        self.repository = repository
        self.cache = cache
        self.requestIDs = requestIDs
        self.lease = lease
    }

    func makeLoadRequest(authState: AuthState) -> BoardLoadRequest {
        let leaseToken: BoardSessionLeaseToken?
        if case .admitted(let identity) = authState {
            leaseToken = lease?.token(for: identity.id)
        } else {
            leaseToken = nil
        }
        return BoardLoadRequest(
            authState: authState,
            leaseToken: leaseToken
        )
    }

    func load(authState: AuthState) async {
        await load(
            request: BoardLoadRequest(
                authState: authState,
                leaseToken: nil
            )
        )
    }

    func load(request: BoardLoadRequest) async {
        guard case .admitted(let identity) = request.authState else {
            lease?.invalidate()
            lifecycleGeneration &+= 1
            paginationGeneration = nil
            activeLeaseToken = nil
            state = .loading
            await cache.purge(
                reason: request.authState == .signedOut
                    ? .signedOut
                    : .authExpired
            )
            state = .authenticationRequired
            return
        }
        guard
            isCurrent(
                request.leaseToken,
                ownerID: identity.id
            )
        else {
            return
        }

        lifecycleGeneration &+= 1
        paginationGeneration = nil
        activeLeaseToken = request.leaseToken
        let generation = lifecycleGeneration
        state = .loading
        await BoardSessionLeaseScope.$token.withValue(
            request.leaseToken
        ) {
            await cache.purgeMemberPartition()
            guard isActiveLeaseCurrent else {
                return
            }
            await loadAdmitted(generation: generation)
        }
    }

    func loadNextFeedPage() async {
        guard
            case .loaded(let current) = state,
            let cursor = current.feed.next,
            paginationGeneration == nil,
            isActiveLeaseCurrent
        else {
            return
        }
        await BoardSessionLeaseScope.$token.withValue(
            activeLeaseToken
        ) {
            let generation = lifecycleGeneration
            paginationGeneration = generation
            let cacheToken = await cache.writeToken(for: .member)
            defer {
                if paginationGeneration == generation {
                    paginationGeneration = nil
                }
            }
            do {
                let page = try await repository.feed(
                    page: BoardPageRequest(cursor: cursor)
                )
                guard
                    generation == lifecycleGeneration,
                    isActiveLeaseCurrent
                else {
                    return
                }
                let merged = BoardFeedPage(
                    posts: current.feed.posts + page.posts,
                    next: page.next
                )
                guard
                    await cache.replaceFeed(
                        merged,
                        ifCurrent: cacheToken
                    ),
                    isActiveLeaseCurrent
                else {
                    return
                }
                state = .loaded(
                    BoardLoadedState(
                        status: current.status,
                        feed: merged,
                        permissions: current.permissions,
                        availability: current.availability
                    )
                )
            } catch {
                guard
                    generation == lifecycleGeneration,
                    isActiveLeaseCurrent
                else {
                    return
                }
                await present(error)
            }
        }
    }

    func createPost(title: String?, body: String) async {
        guard
            case .loaded(let current) = state,
            current.permissions.canCreate,
            isActiveLeaseCurrent
        else {
            return
        }

        await BoardSessionLeaseScope.$token.withValue(
            activeLeaseToken
        ) {
            lifecycleGeneration &+= 1
            paginationGeneration = nil
            let generation = lifecycleGeneration
            state = .loading
            let requestID = await requestIDs.next()
            guard
                generation == lifecycleGeneration,
                isActiveLeaseCurrent
            else {
                return
            }
            do {
                _ = try await repository.createPost(
                    BoardCreatePostCommand(
                        clientRequestID: requestID,
                        title: title,
                        body: body
                    )
                )
                guard
                    generation == lifecycleGeneration,
                    isActiveLeaseCurrent
                else {
                    return
                }
                await loadAdmitted(generation: generation)
            } catch {
                guard
                    generation == lifecycleGeneration,
                    isActiveLeaseCurrent
                else {
                    return
                }
                await present(error)
            }
        }
    }

    func handleLifecycle(_ event: BoardLifecycleEvent) async {
        lease?.invalidate()
        let generation = beginLifecycleInvalidation()
        await cache.purge(reason: event.cachePurgeReason)
        completeLifecycleInvalidation(generation: generation)
    }

    @discardableResult
    func beginLifecycleInvalidation() -> UInt64 {
        lifecycleGeneration &+= 1
        paginationGeneration = nil
        activeLeaseToken = nil
        state = .loading
        return lifecycleGeneration
    }

    func completeLifecycleInvalidation(generation: UInt64) {
        guard generation == lifecycleGeneration else {
            return
        }
        state = .authenticationRequired
    }

    private func loadAdmitted(generation: UInt64) async {
        let cacheToken = await cache.writeToken(for: .member)
        do {
            let status = try await repository.status()
            guard
                generation == lifecycleGeneration,
                isActiveLeaseCurrent
            else {
                return
            }
            guard
                await cache.replaceStatus(
                    status,
                    ifCurrent: cacheToken
                ),
                isActiveLeaseCurrent
            else {
                return
            }
            guard status.enabled else {
                guard isActiveLeaseCurrent else {
                    return
                }
                state = .disabled(
                    BoardStatePresentation.make(for: .disabled)
                )
                return
            }

            let feed = try await repository.feed(
                page: BoardPageRequest()
            )
            guard
                generation == lifecycleGeneration,
                isActiveLeaseCurrent
            else {
                return
            }
            guard
                await cache.replaceFeed(
                    feed,
                    ifCurrent: cacheToken
                ),
                isActiveLeaseCurrent
            else {
                return
            }
            let isBanned = status.ban != nil
            state = .loaded(
                BoardLoadedState(
                    status: status,
                    feed: feed,
                    permissions: isBanned ? .banned : .active,
                    availability: BoardStatePresentation.make(
                        for: isBanned ? .banned : .enabled
                    )
                )
            )
        } catch {
            guard
                generation == lifecycleGeneration,
                isActiveLeaseCurrent
            else {
                return
            }
            await present(error)
        }
    }

    private var isActiveLeaseCurrent: Bool {
        guard let lease else {
            return true
        }
        guard let activeLeaseToken else {
            return false
        }
        return lease.isCurrent(activeLeaseToken)
    }

    private func isCurrent(
        _ token: BoardSessionLeaseToken?,
        ownerID: UUID
    ) -> Bool {
        guard let lease else {
            return true
        }
        guard let token else {
            return false
        }
        return lease.isCurrent(token, for: ownerID)
    }

    private func present(_ error: Error) async {
        let value = (error as? BoardError) ?? .invalidResponse
        switch value {
        case .authenticationRequired, .brownMembershipRequired:
            await cache.purgeMemberPartition()
            state = .authenticationRequired
        case .disabled:
            state = .disabled(
                BoardStatePresentation.make(for: .disabled)
            )
        case .quotaLimited:
            state = .quotaLimited(
                BoardStatePresentation.make(for: .quotaLimited)
            )
        case .conflict:
            state = .conflict(
                BoardStatePresentation.make(for: .conflict)
            )
        case .banned:
            state = .failed(
                value,
                BoardStatePresentation.make(for: .banned)
            )
        case .authorityRequired:
            await cache.purgeMemberPartition()
            state = .failed(
                value,
                BoardStatePresentation.make(for: .authorityRequired)
            )
        case .invalidPage, .invalidRequest, .notFound,
            .unavailable, .invalidResponse:
            state = .failed(
                value,
                BoardStatePresentation.make(for: .unavailable)
            )
        }
    }
}
