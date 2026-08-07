import Auth
import Foundation
import Supabase

struct GoogleIdentityTokenPair: Equatable, Sendable {
    let idToken: String
    let accessToken: String
    let hostedDomain: String?
}

enum SupabaseIdentityProvider: Equatable, Sendable {
    case google
}

struct SupabaseGoogleCredentialValues: Equatable, Sendable {
    let provider: SupabaseIdentityProvider
    let idToken: String
    let accessToken: String
    let nonce: String?
}

final class TransientAuthLocalStorage:
    AuthLocalStorage,
    @unchecked Sendable,
    CustomStringConvertible,
    CustomDebugStringConvertible,
    CustomReflectable
{
    private let lock = NSLock()
    private var values: [String: Data] = [:]

    func store(key: String, value: Data) throws {
        lock.lock()
        values[key] = value
        lock.unlock()
    }

    func retrieve(key: String) throws -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return values[key]
    }

    func remove(key: String) throws {
        lock.lock()
        values[key] = nil
        lock.unlock()
    }

    func clear() {
        lock.lock()
        values.removeAll(keepingCapacity: false)
        lock.unlock()
    }

    deinit {
        clear()
    }

    var description: String {
        "<redacted transient auth storage>"
    }

    var debugDescription: String {
        description
    }

    var customMirror: Mirror {
        Mirror(self, children: ["value": description])
    }
}

enum AuthSessionEvent: Equatable, Sendable {
    case initialSession(hasSession: Bool)
    case signedIn
    case tokenRefreshed
    case signedOut
    case userDeleted
}

protocol SessionProviding: Sendable {
    func exchangeGoogleIdentity(_ pair: GoogleIdentityTokenPair) async throws
    func validAccessToken() async throws -> String
    func refreshSession() async throws
    func signOutLocal() async throws
    func authEvents() async -> AsyncStream<AuthSessionEvent>
}

actor SupabaseSessionStore: SessionProviding {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    nonisolated static func credentialValues(
        for pair: GoogleIdentityTokenPair
    ) -> SupabaseGoogleCredentialValues {
        SupabaseGoogleCredentialValues(
            provider: .google,
            idToken: pair.idToken,
            accessToken: pair.accessToken,
            nonce: nil
        )
    }

    func exchangeGoogleIdentity(_ pair: GoogleIdentityTokenPair) async throws {
        let values = Self.credentialValues(for: pair)
        _ = try await client.auth.signInWithIdToken(
            credentials: OpenIDConnectCredentials(
                provider: .google,
                idToken: values.idToken,
                accessToken: values.accessToken,
                nonce: values.nonce
            )
        )
    }

    func validAccessToken() async throws -> String {
        try await client.auth.session.accessToken
    }

    func refreshSession() async throws {
        _ = try await client.auth.refreshSession()
    }

    func signOutLocal() async throws {
        try await client.auth.signOut(scope: .local)
    }

    nonisolated func authEvents() async -> AsyncStream<AuthSessionEvent> {
        let changes = client.auth.authStateChanges
        return AsyncStream { continuation in
            let task = Task {
                for await change in changes {
                    guard !Task.isCancelled else { break }
                    switch change.event {
                    case .initialSession:
                        continuation.yield(
                            .initialSession(hasSession: change.session != nil)
                        )
                    case .signedIn:
                        continuation.yield(.signedIn)
                    case .tokenRefreshed:
                        continuation.yield(.tokenRefreshed)
                    case .signedOut:
                        continuation.yield(.signedOut)
                    case .userDeleted:
                        continuation.yield(.userDeleted)
                    case .passwordRecovery, .userUpdated,
                         .mfaChallengeVerified:
                        break
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }
}

@MainActor
final class SupabaseAuthCallbackHandler: SupabaseCallbackHandling {
    private let client: SupabaseClient

    init(client: SupabaseClient) {
        self.client = client
    }

    func establishSession(from url: URL) async throws {
        _ = try await client.auth.session(from: url)
    }
}
