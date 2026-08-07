import BrownSyncAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import XCTest

@testable import BrownSync

@MainActor
final class AppContainerTests: XCTestCase {
    func testSyntheticContainerComposesInjectedAuthBoundaries() async throws {
        let identity = AdmittedIdentity(
            id: UUID(uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")!,
            email: "student@brown.edu"
        )
        let publicShellDependencies = PublicShellDependencies.production(
            client: BrownSyncAPI.Client(
                serverURL: URL(
                    string: "https://api.brownsync.invalid"
                )!,
                transport: ContainerPublicTransportFake()
            ),
            cacheDirectory: FileManager.default.temporaryDirectory
                .appendingPathComponent(
                    "brownsync-container-\(UUID().uuidString)",
                    isDirectory: true
                )
        )
        let container = AppContainer(
            configuration: try AppConfiguration(
                info: [
                    "BROWNSYNC_API_BASE_URL": "https://api.brownsync.invalid",
                    "BROWNSYNC_SUPABASE_URL": "https://project.supabase.co",
                    "BROWNSYNC_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test",
                    "BROWNSYNC_GOOGLE_IOS_CLIENT_ID":
                        "123456789-test.apps.googleusercontent.com",
                    "BROWNSYNC_GOOGLE_SERVER_CLIENT_ID":
                        "987654321-test.apps.googleusercontent.com",
                    "BROWNSYNC_GOOGLE_REVERSED_CLIENT_ID":
                        "com.googleusercontent.apps.123456789-test",
                ],
                environment: .debug
            ),
            session: ContainerSessionFake(),
            googleIdentity: ContainerGoogleFake(),
            account: ContainerAccountFake(identity: identity),
            recentAuthenticationContextCreator:
                ContainerRecentAuthenticationContextCreatorFake(),
            invalidator: ContainerInvalidatorFake(),
            supabaseCallbacks: ContainerSupabaseCallbackFake(),
            publicShellDependencies: publicShellDependencies
        )

        try await container.authCoordinator.signInInteractively()

        XCTAssertEqual(container.authCoordinator.state, .admitted(identity))
        XCTAssertEqual(
            container.configuration.apiBaseURL.absoluteString,
            "https://api.brownsync.invalid"
        )
    }
}

private struct ContainerPublicTransportFake: ClientTransport {
    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        throw URLError(.notConnectedToInternet)
    }
}

private actor ContainerSessionFake: SessionProviding {
    func exchangeGoogleIdentity(_ pair: GoogleIdentityTokenPair) async throws {}
    func validAccessToken() async throws -> String { "token" }
    func refreshSession() async throws {}
    func signOutLocal() async throws {}
    func authEvents() -> AsyncStream<AuthSessionEvent> {
        AsyncStream { $0.finish() }
    }
}

private final class ContainerGoogleFake:
    GoogleIdentityProviding,
    @unchecked Sendable
{
    func configure() async throws {}
    func interactiveTokenPair() async throws -> GoogleIdentityTokenPair {
        GoogleIdentityTokenPair(
            idToken: "id",
            accessToken: "access",
            hostedDomain: "brown.edu"
        )
    }
    func restoreTokenPair() async throws -> GoogleIdentityTokenPair? { nil }
    func signOut() async {}
    func handle(_ url: URL) -> Bool { false }
}

private actor ContainerAccountFake: AccountRepository {
    private let identity: AdmittedIdentity
    init(identity: AdmittedIdentity) { self.identity = identity }
    func currentIdentity() async throws -> AdmittedIdentity { identity }
    func deleteAccount() async throws {}
}

private actor ContainerRecentAuthenticationContextCreatorFake:
    RecentAuthenticationContextCreating
{
    func makeContext(
        googleIdentity pair: GoogleIdentityTokenPair
    ) async throws -> any RecentAuthenticationContext {
        throw APIError.unavailable
    }
}

private actor ContainerInvalidatorFake: ProtectedSessionInvalidating {
    func invalidate(reason: SensitiveCachePurgeReason) async {}
}

@MainActor
private final class ContainerSupabaseCallbackFake: SupabaseCallbackHandling {
    func establishSession(from url: URL) async throws {}
}
