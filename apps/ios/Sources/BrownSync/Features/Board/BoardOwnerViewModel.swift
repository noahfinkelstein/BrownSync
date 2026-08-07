import Combine
import Foundation

@MainActor
final class BoardOwnerViewModel: ObservableObject {
    @Published private(set) var state: BoardOwnerScreenState = .authenticationRequired

    private let repository: any BoardOwnerRepository
    private let cache: BoardMemoryCache
    private let lease: BoardSessionLease?
    private var lifecycleGeneration: UInt64 = 0
    private var activeLeaseToken: BoardSessionLeaseToken?

    init(
        repository: any BoardOwnerRepository,
        cache: BoardMemoryCache,
        lease: BoardSessionLease? = nil
    ) {
        self.repository = repository
        self.cache = cache
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
            activeLeaseToken = nil
            state = .loading
            await cache.purgeOwnerPartition()
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
        activeLeaseToken = request.leaseToken
        let generation = lifecycleGeneration
        state = .loading
        await BoardSessionLeaseScope.$token.withValue(
            request.leaseToken
        ) {
            await cache.purgeOwnerPartition()
            guard isActiveLeaseCurrent else {
                return
            }
            let cacheToken = await cache.writeToken(for: .owner)
            do {
                let config = try await repository.config()
                guard
                    generation == lifecycleGeneration,
                    isActiveLeaseCurrent
                else {
                    return
                }
                guard
                    await cache.replaceConfig(
                        config,
                        ifCurrent: cacheToken
                    ),
                    isActiveLeaseCurrent
                else {
                    return
                }

                let moderators = try await repository.moderators(
                    page: BoardPageRequest()
                )
                guard
                    generation == lifecycleGeneration,
                    isActiveLeaseCurrent
                else {
                    return
                }
                guard
                    await cache.replaceModerators(
                        moderators,
                        ifCurrent: cacheToken
                    ),
                    isActiveLeaseCurrent
                else {
                    return
                }
                state = .loaded(
                    config: config,
                    moderators: moderators
                )
            } catch {
                guard
                    generation == lifecycleGeneration,
                    isActiveLeaseCurrent
                else {
                    return
                }
                let value = (error as? BoardError) ?? .invalidResponse
                switch value {
                case .authorityRequired:
                    await cache.purgeOwnerPartition()
                    guard isActiveLeaseCurrent else {
                        return
                    }
                    state = .authorityRequired
                case .authenticationRequired, .brownMembershipRequired:
                    await cache.purgeOwnerPartition()
                    guard isActiveLeaseCurrent else {
                        return
                    }
                    state = .authenticationRequired
                case .invalidPage, .invalidRequest, .banned, .notFound,
                    .conflict, .quotaLimited, .disabled, .unavailable,
                    .invalidResponse:
                    state = .failed(
                        value,
                        BoardStatePresentation.make(
                            for: value == .conflict
                                ? .conflict
                                : .unavailable
                        )
                    )
                }
            }
        }
    }

    @discardableResult
    func beginLifecycleInvalidation() -> UInt64 {
        lifecycleGeneration &+= 1
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
}
