import Auth
import Foundation
import Supabase

enum RecentAuthenticationError: Error, Equatable, Sendable {
    case identityMismatch
}

protocol RecentAuthenticationContext: Sendable {
    func currentIdentity() async throws -> AdmittedIdentity
    func deleteAccount() async throws
    func clear() async
}

protocol RecentAuthenticationContextCreating: Sendable {
    func makeContext(
        googleIdentity pair: GoogleIdentityTokenPair
    ) async throws -> any RecentAuthenticationContext
}

struct SupabaseRecentAuthenticationContextFactory:
    RecentAuthenticationContextCreating
{
    private let supabaseURL: URL
    private let supabasePublishableKey: String
    private let apiBaseURL: URL
    private let urlSession: URLSession
    private let storageFactory:
        @Sendable () -> TransientAuthLocalStorage

    init(
        supabaseURL: URL,
        supabasePublishableKey: String,
        apiBaseURL: URL,
        urlSession: URLSession = .shared,
        storageFactory: @escaping @Sendable () ->
            TransientAuthLocalStorage = { TransientAuthLocalStorage() }
    ) {
        self.supabaseURL = supabaseURL
        self.supabasePublishableKey = supabasePublishableKey
        self.apiBaseURL = apiBaseURL
        self.urlSession = urlSession
        self.storageFactory = storageFactory
    }

    func makeContext(
        googleIdentity pair: GoogleIdentityTokenPair
    ) async throws -> any RecentAuthenticationContext {
        let storage = storageFactory()
        defer { storage.clear() }

        let supabase = SupabaseClient(
            supabaseURL: supabaseURL,
            supabaseKey: supabasePublishableKey,
            options: SupabaseClientOptions(
                auth: .init(
                    storage: storage,
                    autoRefreshToken: false
                ),
                global: .init(session: urlSession)
            )
        )
        let values = SupabaseSessionStore.credentialValues(for: pair)
        let isolatedSession = try await supabase.auth.signInWithIdToken(
            credentials: OpenIDConnectCredentials(
                provider: .google,
                idToken: values.idToken,
                accessToken: values.accessToken,
                nonce: values.nonce
            )
        )
        try Task.checkCancellation()

        let token = TransientAccessToken(isolatedSession.accessToken)
        let clients = WorkerAPIClients(
            baseURL: apiBaseURL,
            tokenProvider: token,
            urlSession: urlSession
        )
        let account = WorkerAccountRepository(
            client: clients.protectedClient,
            retrier: .withoutAuthenticationRetry
        )
        return WorkerRecentAuthenticationContext(
            account: account,
            token: token
        )
    }
}

final class WorkerRecentAuthenticationContext:
    RecentAuthenticationContext,
    @unchecked Sendable,
    CustomStringConvertible,
    CustomDebugStringConvertible,
    CustomReflectable
{
    private let account: WorkerAccountRepository
    private let token: TransientAccessToken

    init(
        account: WorkerAccountRepository,
        token: TransientAccessToken
    ) {
        self.account = account
        self.token = token
    }

    func currentIdentity() async throws -> AdmittedIdentity {
        try await account.currentIdentity()
    }

    func deleteAccount() async throws {
        try await account.deleteAccount()
    }

    func clear() async {
        token.clear()
    }

    deinit {
        token.clear()
    }

    var description: String {
        "<redacted recent authentication context>"
    }

    var debugDescription: String {
        description
    }

    var customMirror: Mirror {
        Mirror(self, children: ["value": description])
    }
}

struct RecentAuthenticationCoordinator: Sendable {
    private let googleIdentity: any GoogleIdentityProviding
    private let canonicalSession: any SessionProviding
    private let contextCreator: any RecentAuthenticationContextCreating
    private let invalidator: any ProtectedSessionInvalidating

    init(
        googleIdentity: any GoogleIdentityProviding,
        canonicalSession: any SessionProviding,
        contextCreator: any RecentAuthenticationContextCreating,
        invalidator: any ProtectedSessionInvalidating
    ) {
        self.googleIdentity = googleIdentity
        self.canonicalSession = canonicalSession
        self.contextCreator = contextCreator
        self.invalidator = invalidator
    }

    func deleteAccount(expectedUserID: UUID) async throws {
        let pair = try await googleIdentity.interactiveTokenPair()
        try Task.checkCancellation()
        try AuthCoordinator.requireBrownHostedDomainIfPresent(
            pair.hostedDomain
        )
        let context = try await contextCreator.makeContext(
            googleIdentity: pair
        )

        do {
            try Task.checkCancellation()
            let identity = try await context.currentIdentity()
            try Task.checkCancellation()
            guard identity.id == expectedUserID else {
                throw RecentAuthenticationError.identityMismatch
            }
            try Task.checkCancellation()
            try await context.deleteAccount()
        } catch {
            await clearUncancelled(context)
            throw error
        }

        await clearUncancelled(context)
        await Task.detached {
            await invalidator.invalidate(reason: .accountDeleted)
            try? await canonicalSession.signOutLocal()
            await googleIdentity.signOut()
        }.value
    }

    private func clearUncancelled(
        _ context: any RecentAuthenticationContext
    ) async {
        await Task.detached {
            await context.clear()
        }.value
    }
}
