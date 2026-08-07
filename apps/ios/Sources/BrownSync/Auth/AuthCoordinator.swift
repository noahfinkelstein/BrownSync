import Combine
import Foundation

struct AdmittedIdentity: Equatable, Sendable {
    let id: UUID
    let email: String
}

enum AuthState: Equatable, Sendable {
    case signedOut
    case authenticating
    case admitted(AdmittedIdentity)
}

enum AuthError: Error, Equatable {
    case nonBrownGoogleAccount
}

protocol AccountRepository: Sendable {
    func currentIdentity() async throws -> AdmittedIdentity
    func deleteAccount() async throws
}

enum SensitiveCachePurgeReason: Equatable, Sendable {
    case signedOut
    case authExpired
    case accountDeleted
    case shareRevoked(viewerID: UUID)
    case ghostEnabled
    case presenceCleared
    case presenceExpired(userID: UUID)
    case sceneBackgrounded
}

protocol ProtectedTaskCancelling: Sendable {
    func cancelProtectedTasks() async
}

protocol ProtectedTaskActivating: Sendable {
    func activateProtectedSession(userID: UUID) async
}

protocol RealtimeChannelRemoving: Sendable {
    func removeRealtimeChannels() async
}

protocol ProtectedNavigationClearing: Sendable {
    func clearProtectedNavigation() async
}

protocol SensitiveCachePurging: Sendable {
    func purge(reason: SensitiveCachePurgeReason) async
}

protocol ProtectedSessionInvalidating: Sendable {
    func activate(userID: UUID) async
    func invalidate(reason: SensitiveCachePurgeReason) async
}

extension ProtectedSessionInvalidating {
    func activate(userID _: UUID) async {}
}

struct ProtectedSessionInvalidator: ProtectedSessionInvalidating {
    private let tasks: any ProtectedTaskCancelling
    private let realtime: any RealtimeChannelRemoving
    private let navigation: any ProtectedNavigationClearing
    private let caches: any SensitiveCachePurging

    init(
        tasks: any ProtectedTaskCancelling,
        realtime: any RealtimeChannelRemoving,
        navigation: any ProtectedNavigationClearing,
        caches: any SensitiveCachePurging
    ) {
        self.tasks = tasks
        self.realtime = realtime
        self.navigation = navigation
        self.caches = caches
    }

    func invalidate(reason: SensitiveCachePurgeReason) async {
        await tasks.cancelProtectedTasks()
        await realtime.removeRealtimeChannels()
        await navigation.clearProtectedNavigation()
        await caches.purge(reason: reason)
    }

    func activate(userID: UUID) async {
        guard
            let activatingTasks = tasks as? any ProtectedTaskActivating
        else {
            return
        }
        await activatingTasks.activateProtectedSession(userID: userID)
    }
}

@MainActor
final class AuthCoordinator: ObservableObject {
    @Published private(set) var state: AuthState = .signedOut

    private let googleIdentity: any GoogleIdentityProviding
    private let session: any SessionProviding
    private let account: any AccountRepository
    private let invalidator: any ProtectedSessionInvalidating
    private var eventTask: Task<Void, Never>?

    init(
        googleIdentity: any GoogleIdentityProviding,
        session: any SessionProviding,
        account: any AccountRepository,
        invalidator: any ProtectedSessionInvalidating
    ) {
        self.googleIdentity = googleIdentity
        self.session = session
        self.account = account
        self.invalidator = invalidator
    }

    func start() {
        guard eventTask == nil else { return }
        eventTask = Task { [weak self, session] in
            let events = await session.authEvents()
            for await event in events {
                guard !Task.isCancelled else { return }
                await self?.handleSessionEvent(event)
            }
        }
    }

    func stop() {
        eventTask?.cancel()
        eventTask = nil
    }

    func configureIdentityProvider() async throws {
        try await googleIdentity.configure()
    }

    func signInInteractively() async throws {
        state = .authenticating
        do {
            let pair = try await googleIdentity.interactiveTokenPair()
            try Self.requireBrownHostedDomainIfPresent(pair.hostedDomain)
            try await session.exchangeGoogleIdentity(pair)
            let identity = try await account.currentIdentity()
            await invalidator.activate(userID: identity.id)
            state = .admitted(identity)
        } catch {
            let terminalFailure =
                await invalidateSessionIfTerminal(error)
            if !terminalFailure {
                state = .signedOut
            }
            throw error
        }
    }

    func signOut() async {
        await invalidator.invalidate(reason: .signedOut)
        try? await session.signOutLocal()
        await googleIdentity.signOut()
        state = .signedOut
    }

    func handleSessionEvent(_ event: AuthSessionEvent) async {
        switch event {
        case .initialSession(let hasSession):
            guard hasSession else {
                await invalidator.invalidate(reason: .signedOut)
                state = .signedOut
                return
            }
            state = .authenticating
            do {
                let identity = try await account.currentIdentity()
                await invalidator.activate(userID: identity.id)
                state = .admitted(identity)
            } catch {
                let terminalFailure =
                    await invalidateSessionIfTerminal(error)
                if !terminalFailure {
                    state = .signedOut
                }
            }
        case .signedIn:
            // Supabase sign-in alone is not BrownSync admission. `/api/me`
            // remains the authority in the interactive/bootstrap flows.
            break
        case .tokenRefreshed:
            break
        case .signedOut:
            await invalidator.invalidate(reason: .signedOut)
            state = .signedOut
        case .userDeleted:
            await invalidator.invalidate(reason: .accountDeleted)
            state = .signedOut
        }
    }

    func handleTerminalAuthorizationFailure(
        _ error: APIError
    ) async {
        guard
            error == .unauthorized
                || error == .brownMembershipRequired
        else {
            return
        }
        await invalidator.invalidate(reason: .authExpired)
        try? await session.signOutLocal()
        state = .signedOut
    }

    @discardableResult
    private func invalidateSessionIfTerminal(
        _ error: Error
    ) async -> Bool {
        guard let apiError = error as? APIError else {
            return false
        }
        guard
            apiError == .unauthorized
                || apiError == .brownMembershipRequired
        else {
            return false
        }
        await handleTerminalAuthorizationFailure(apiError)
        return true
    }

    nonisolated static func requireBrownHostedDomainIfPresent(
        _ hostedDomain: String?
    ) throws {
        guard
            let hostedDomain,
            hostedDomain.caseInsensitiveCompare("brown.edu") != .orderedSame
        else {
            return
        }
        throw AuthError.nonBrownGoogleAccount
    }
}
