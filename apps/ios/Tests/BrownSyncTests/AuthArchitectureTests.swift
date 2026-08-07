import Combine
import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class AuthArchitectureTests: XCTestCase {
    func testGoogleTokenPairMapsBothTokensToGoogleSupabaseCredentials() {
        let pair = GoogleIdentityTokenPair(
            idToken: "google-id-token",
            accessToken: "google-access-token",
            hostedDomain: "brown.edu"
        )

        let credentials = SupabaseSessionStore.credentialValues(for: pair)

        XCTAssertEqual(credentials.provider, .google)
        XCTAssertEqual(credentials.idToken, "google-id-token")
        XCTAssertEqual(credentials.accessToken, "google-access-token")
        XCTAssertNil(credentials.nonce)
    }

    func testHostedDomainMismatchStopsBeforeSessionExchangeOrAdmission() async {
        let log = AuthCallLog()
        let coordinator = makeCoordinator(
            pair: GoogleIdentityTokenPair(
                idToken: "id",
                accessToken: "access",
                hostedDomain: "example.edu"
            ),
            log: log
        )

        await XCTAssertThrowsAuthError {
            try await coordinator.signInInteractively()
        } verify: { error in
            XCTAssertEqual(error as? AuthError, .nonBrownGoogleAccount)
        }

        XCTAssertEqual(coordinator.state, .signedOut)
        let entries = await log.values()
        XCTAssertEqual(entries, ["google.interactive"])
    }

    func testWorkerMeIsTheAdmissionAuthorityAfterSupabaseExchange() async throws {
        let id = UUID()
        let log = AuthCallLog()
        let coordinator = makeCoordinator(
            pair: GoogleIdentityTokenPair(
                idToken: "id",
                accessToken: "access",
                hostedDomain: "brown.edu"
            ),
            identityResult: .success(
                AdmittedIdentity(id: id, email: "student@brown.edu")
            ),
            log: log
        )

        try await coordinator.signInInteractively()

        XCTAssertEqual(
            coordinator.state,
            .admitted(AdmittedIdentity(id: id, email: "student@brown.edu"))
        )
        let entries = await log.values()
        XCTAssertEqual(entries, ["google.interactive", "session.exchange", "account.me"])
    }

    func testMembershipFailureNeverEstablishesAdmittedState() async {
        let log = AuthCallLog()
        let coordinator = makeCoordinator(
            pair: GoogleIdentityTokenPair(
                idToken: "id",
                accessToken: "access",
                hostedDomain: "brown.edu"
            ),
            identityResult: .failure(APIError.brownMembershipRequired),
            log: log
        )

        await XCTAssertThrowsAuthError {
            try await coordinator.signInInteractively()
        } verify: { error in
            XCTAssertEqual(error as? APIError, .brownMembershipRequired)
        }

        XCTAssertEqual(coordinator.state, .signedOut)
        let entries = await log.values()
        XCTAssertEqual(
            entries,
            [
                "google.interactive",
                "session.exchange",
                "account.me",
                "invalidate.authExpired",
                "session.signout",
            ]
        )
    }

    func testInteractiveSecondUnauthorizedAfterOneRefreshSignsOutInOrder()
        async
    {
        let log = TerminalAuthLog()
        let coordinator = makeTerminalUnauthorizedCoordinator(log: log)
        let stateObservation = coordinator.$state
            .dropFirst()
            .sink { state in
                if state == .signedOut {
                    log.append("state.signedOut")
                }
            }

        await XCTAssertThrowsAuthError {
            try await coordinator.signInInteractively()
        } verify: { error in
            XCTAssertEqual(error as? APIError, .unauthorized)
        }

        XCTAssertEqual(coordinator.state, .signedOut)
        XCTAssertEqual(
            log.values(),
            [
                "google.interactive",
                "session.exchange",
                "account.me.1",
                "session.refresh",
                "account.me.2",
                "invalidate.authExpired",
                "session.signout",
                "state.signedOut",
            ]
        )
        withExtendedLifetime(stateObservation) {}
    }

    func testBootstrapSecondUnauthorizedAfterOneRefreshSignsOutInOrder()
        async
    {
        let log = TerminalAuthLog()
        let coordinator = makeTerminalUnauthorizedCoordinator(log: log)
        let stateObservation = coordinator.$state
            .dropFirst()
            .sink { state in
                if state == .signedOut {
                    log.append("state.signedOut")
                }
            }

        await coordinator.handleSessionEvent(
            .initialSession(hasSession: true)
        )

        XCTAssertEqual(coordinator.state, .signedOut)
        XCTAssertEqual(
            log.values(),
            [
                "account.me.1",
                "session.refresh",
                "account.me.2",
                "invalidate.authExpired",
                "session.signout",
                "state.signedOut",
            ]
        )
        withExtendedLifetime(stateObservation) {}
    }

    func testInteractiveRefreshFailureSignsOutWithoutSecondRequest()
        async
    {
        let log = TerminalAuthLog()
        let coordinator = makeTerminalUnauthorizedCoordinator(
            log: log,
            refreshResult: .failure(TerminalRefreshError.failed)
        )
        let stateObservation = coordinator.$state
            .dropFirst()
            .sink { state in
                if state == .signedOut {
                    log.append("state.signedOut")
                }
            }

        await XCTAssertThrowsAuthError {
            try await coordinator.signInInteractively()
        } verify: { error in
            XCTAssertEqual(error as? APIError, .unauthorized)
        }

        XCTAssertEqual(coordinator.state, .signedOut)
        XCTAssertEqual(
            log.values(),
            [
                "google.interactive",
                "session.exchange",
                "account.me.1",
                "session.refresh",
                "invalidate.authExpired",
                "session.signout",
                "state.signedOut",
            ]
        )
        withExtendedLifetime(stateObservation) {}
    }

    func testBootstrapRefreshFailureSignsOutWithoutSecondRequest() async {
        let log = TerminalAuthLog()
        let coordinator = makeTerminalUnauthorizedCoordinator(
            log: log,
            refreshResult: .failure(TerminalRefreshError.failed)
        )
        let stateObservation = coordinator.$state
            .dropFirst()
            .sink { state in
                if state == .signedOut {
                    log.append("state.signedOut")
                }
            }

        await coordinator.handleSessionEvent(
            .initialSession(hasSession: true)
        )

        XCTAssertEqual(coordinator.state, .signedOut)
        XCTAssertEqual(
            log.values(),
            [
                "account.me.1",
                "session.refresh",
                "invalidate.authExpired",
                "session.signout",
                "state.signedOut",
            ]
        )
        withExtendedLifetime(stateObservation) {}
    }

    func testBearerProviderReadsTheCurrentSessionTokenForEveryRequest() async throws {
        let log = AuthCallLog()
        let session = AuthSessionFake(token: "first-token", log: log)
        let provider = BearerTokenProvider(session: session)

        let firstToken = try await provider.accessToken()
        XCTAssertEqual(firstToken, "first-token")
        await session.setToken("refreshed-token")
        let refreshedToken = try await provider.accessToken()
        XCTAssertEqual(refreshedToken, "refreshed-token")
        let entries = await log.values()
        XCTAssertEqual(entries, ["session.token", "session.token"])
    }

    func testSafeReadRefreshesOnceAfterUnauthorized() async throws {
        let log = AuthCallLog()
        let session = AuthSessionFake(token: "token", log: log)
        let retrier = WorkerRequestRetrier(session: session)
        let attempts = AuthAttemptCounter()

        let value: String = try await retrier.run(method: .get) {
            let attempt = await attempts.increment()
            await log.append("request.\(attempt)")
            if attempt == 1 {
                throw APIError.unauthorized
            }
            return "ok"
        }

        XCTAssertEqual(value, "ok")
        let attemptCount = await attempts.value()
        let entries = await log.values()
        XCTAssertEqual(attemptCount, 2)
        XCTAssertEqual(entries, ["request.1", "session.refresh", "request.2"])
    }

    func testSafeReadDoesNotRetryASecondUnauthorized() async {
        let log = AuthCallLog()
        let retrier = WorkerRequestRetrier(
            session: AuthSessionFake(token: "token", log: log)
        )
        let attempts = AuthAttemptCounter()

        await XCTAssertThrowsAuthError {
            let _: String = try await retrier.run(method: .head) {
                _ = await attempts.increment()
                throw APIError.unauthorized
            }
        } verify: { error in
            XCTAssertEqual(error as? APIError, .unauthorized)
        }

        let attemptCount = await attempts.value()
        let entries = await log.values()
        XCTAssertEqual(attemptCount, 2)
        XCTAssertEqual(entries, ["session.refresh"])
    }

    func testMutationIsNeverAutomaticallyRetried() async {
        let log = AuthCallLog()
        let retrier = WorkerRequestRetrier(
            session: AuthSessionFake(token: "token", log: log)
        )
        let attempts = AuthAttemptCounter()

        await XCTAssertThrowsAuthError {
            let _: String = try await retrier.run(method: .mutation) {
                _ = await attempts.increment()
                throw APIError.unauthorized
            }
        } verify: { error in
            XCTAssertEqual(error as? APIError, .unauthorized)
        }

        let attemptCount = await attempts.value()
        let entries = await log.values()
        XCTAssertEqual(attemptCount, 1)
        XCTAssertEqual(entries, [])
    }

    func testSignedOutEventInvalidatesBeforePublishingSignedOutState() async {
        let log = AuthCallLog()
        let coordinator = makeCoordinator(
            pair: GoogleIdentityTokenPair(
                idToken: "id",
                accessToken: "access",
                hostedDomain: "brown.edu"
            ),
            log: log
        )
        try? await coordinator.signInInteractively()
        await log.clear()

        await coordinator.handleSessionEvent(.signedOut)

        let entries = await log.values()
        XCTAssertEqual(entries, ["invalidate.signedOut"])
        XCTAssertEqual(coordinator.state, .signedOut)
    }

    func testExplicitSignOutInvalidatesProtectedStateBeforeProviderCleanup() async {
        let log = AuthCallLog()
        let coordinator = makeCoordinator(
            pair: GoogleIdentityTokenPair(
                idToken: "id",
                accessToken: "access",
                hostedDomain: "brown.edu"
            ),
            log: log
        )

        await coordinator.signOut()

        let entries = await log.values()
        XCTAssertEqual(
            entries,
            ["invalidate.signedOut", "session.signout", "google.signout"]
        )
        XCTAssertEqual(coordinator.state, .signedOut)
    }

    func testProtectedFeatureTerminalAuthorizationInvalidatesAndSignsOut()
        async throws
    {
        let log = AuthCallLog()
        let coordinator = makeCoordinator(
            pair: GoogleIdentityTokenPair(
                idToken: "id",
                accessToken: "access",
                hostedDomain: "brown.edu"
            ),
            log: log
        )
        try await coordinator.signInInteractively()
        await log.clear()

        await coordinator.handleTerminalAuthorizationFailure(
            .unauthorized
        )

        let entries = await log.values()
        XCTAssertEqual(
            entries,
            ["invalidate.authExpired", "session.signout"]
        )
        XCTAssertEqual(coordinator.state, .signedOut)
    }

    func testProtectedInvalidationUsesPrivacySafeOrder() async {
        let log = AuthCallLog()
        let invalidator = ProtectedSessionInvalidator(
            tasks: AuthProtectedTasksFake(log: log),
            realtime: AuthRealtimeFake(log: log),
            navigation: AuthProtectedNavigationFake(log: log),
            caches: AuthSensitiveCachesFake(log: log)
        )

        await invalidator.invalidate(reason: .authExpired)

        let entries = await log.values()
        XCTAssertEqual(
            entries,
            ["tasks.cancel", "realtime.remove", "navigation.clear", "caches.purge.authExpired"]
        )
    }

    private func makeCoordinator(
        pair: GoogleIdentityTokenPair,
        identityResult: Result<AdmittedIdentity, Error> = .success(
            AdmittedIdentity(id: UUID(), email: "student@brown.edu")
        ),
        log: AuthCallLog
    ) -> AuthCoordinator {
        AuthCoordinator(
            googleIdentity: AuthGoogleFake(pair: pair, log: log),
            session: AuthSessionFake(token: "supabase-token", log: log),
            account: AuthAccountFake(
                identityResult: identityResult,
                log: log
            ),
            invalidator: AuthInvalidatorFake(log: log)
        )
    }

    private func makeTerminalUnauthorizedCoordinator(
        log: TerminalAuthLog,
        refreshResult: Result<Void, Error> = .success(())
    ) -> AuthCoordinator {
        let session = TerminalUnauthorizedSessionFake(
            log: log,
            refreshResult: refreshResult
        )
        return AuthCoordinator(
            googleIdentity: TerminalUnauthorizedGoogleFake(log: log),
            session: session,
            account: TerminalUnauthorizedAccountFake(
                session: session,
                log: log
            ),
            invalidator: TerminalUnauthorizedInvalidatorFake(log: log)
        )
    }
}

private enum TerminalRefreshError: Error {
    case failed
}

private final class TerminalAuthLog: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [String] = []

    func append(_ entry: String) {
        lock.lock()
        entries.append(entry)
        lock.unlock()
    }

    func values() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return entries
    }
}

private actor TerminalUnauthorizedAttemptCounter {
    private var count = 0

    func next() -> Int {
        count += 1
        return count
    }
}

private final class TerminalUnauthorizedGoogleFake:
    GoogleIdentityProviding,
    @unchecked Sendable
{
    private let log: TerminalAuthLog

    init(log: TerminalAuthLog) {
        self.log = log
    }

    func configure() async throws {}

    func interactiveTokenPair() async throws -> GoogleIdentityTokenPair {
        log.append("google.interactive")
        return GoogleIdentityTokenPair(
            idToken: "id",
            accessToken: "access",
            hostedDomain: "brown.edu"
        )
    }

    func restoreTokenPair() async throws -> GoogleIdentityTokenPair? { nil }
    func handle(_ url: URL) -> Bool { false }
    func signOut() async {}
}

private actor TerminalUnauthorizedSessionFake: SessionProviding {
    private let log: TerminalAuthLog
    private let refreshResult: Result<Void, Error>

    init(
        log: TerminalAuthLog,
        refreshResult: Result<Void, Error>
    ) {
        self.log = log
        self.refreshResult = refreshResult
    }

    func exchangeGoogleIdentity(
        _ pair: GoogleIdentityTokenPair
    ) async throws {
        log.append("session.exchange")
    }

    func validAccessToken() async throws -> String {
        "token"
    }

    func refreshSession() async throws {
        log.append("session.refresh")
        try refreshResult.get()
    }

    func signOutLocal() async throws {
        log.append("session.signout")
    }

    func authEvents() -> AsyncStream<AuthSessionEvent> {
        AsyncStream { $0.finish() }
    }
}

private actor TerminalUnauthorizedAccountFake: AccountRepository {
    private let retrier: WorkerRequestRetrier
    private let log: TerminalAuthLog
    private let attempts = TerminalUnauthorizedAttemptCounter()

    init(
        session: any SessionProviding,
        log: TerminalAuthLog
    ) {
        retrier = WorkerRequestRetrier(session: session)
        self.log = log
    }

    func currentIdentity() async throws -> AdmittedIdentity {
        try await retrier.run(method: .get) { [attempts, log] in
            let attempt = await attempts.next()
            log.append("account.me.\(attempt)")
            throw APIError.unauthorized
        }
    }

    func deleteAccount() async throws {}
}

private actor TerminalUnauthorizedInvalidatorFake:
    ProtectedSessionInvalidating
{
    private let log: TerminalAuthLog

    init(log: TerminalAuthLog) {
        self.log = log
    }

    func invalidate(reason: SensitiveCachePurgeReason) async {
        log.append("invalidate.\(reason.authTestName)")
    }
}

private actor AuthCallLog {
    private var entries: [String] = []
    func append(_ entry: String) { entries.append(entry) }
    func values() -> [String] { entries }
    func clear() { entries.removeAll() }
}

private actor AuthAttemptCounter {
    private var count = 0
    func increment() -> Int {
        count += 1
        return count
    }
    func value() -> Int { count }
}

private final class AuthGoogleFake: GoogleIdentityProviding, @unchecked Sendable {
    private let pair: GoogleIdentityTokenPair
    private let log: AuthCallLog

    init(pair: GoogleIdentityTokenPair, log: AuthCallLog) {
        self.pair = pair
        self.log = log
    }

    func configure() async throws {}

    func interactiveTokenPair() async throws -> GoogleIdentityTokenPair {
        await log.append("google.interactive")
        return pair
    }

    func restoreTokenPair() async throws -> GoogleIdentityTokenPair? { nil }
    func handle(_ url: URL) -> Bool { false }
    func signOut() async { await log.append("google.signout") }
}

private actor AuthSessionFake: SessionProviding {
    private var token: String
    private let log: AuthCallLog

    init(token: String, log: AuthCallLog) {
        self.token = token
        self.log = log
    }

    func setToken(_ token: String) { self.token = token }

    func exchangeGoogleIdentity(_ pair: GoogleIdentityTokenPair) async throws {
        await log.append("session.exchange")
    }

    func validAccessToken() async throws -> String {
        await log.append("session.token")
        return token
    }

    func refreshSession() async throws {
        await log.append("session.refresh")
    }

    func signOutLocal() async throws {
        await log.append("session.signout")
    }

    func authEvents() -> AsyncStream<AuthSessionEvent> {
        AsyncStream { $0.finish() }
    }
}

private actor AuthAccountFake: AccountRepository {
    private let identityResult: Result<AdmittedIdentity, Error>
    private let log: AuthCallLog

    init(
        identityResult: Result<AdmittedIdentity, Error>,
        log: AuthCallLog
    ) {
        self.identityResult = identityResult
        self.log = log
    }

    func currentIdentity() async throws -> AdmittedIdentity {
        await log.append("account.me")
        return try identityResult.get()
    }

    func deleteAccount() async throws {
        await log.append("account.delete")
    }
}

private actor AuthInvalidatorFake: ProtectedSessionInvalidating {
    private let log: AuthCallLog
    init(log: AuthCallLog) { self.log = log }
    func invalidate(reason: SensitiveCachePurgeReason) async {
        await log.append("invalidate.\(reason.authTestName)")
    }
}

private actor AuthProtectedTasksFake: ProtectedTaskCancelling {
    private let log: AuthCallLog
    init(log: AuthCallLog) { self.log = log }
    func cancelProtectedTasks() async { await log.append("tasks.cancel") }
}

private actor AuthRealtimeFake: RealtimeChannelRemoving {
    private let log: AuthCallLog
    init(log: AuthCallLog) { self.log = log }
    func removeRealtimeChannels() async { await log.append("realtime.remove") }
}

private actor AuthProtectedNavigationFake: ProtectedNavigationClearing {
    private let log: AuthCallLog
    init(log: AuthCallLog) { self.log = log }
    func clearProtectedNavigation() async { await log.append("navigation.clear") }
}

private actor AuthSensitiveCachesFake: SensitiveCachePurging {
    private let log: AuthCallLog
    init(log: AuthCallLog) { self.log = log }
    func purge(reason: SensitiveCachePurgeReason) async {
        await log.append("caches.purge.\(reason.authTestName)")
    }
}

private extension SensitiveCachePurgeReason {
    var authTestName: String {
        switch self {
        case .signedOut: "signedOut"
        case .authExpired: "authExpired"
        case .accountDeleted: "accountDeleted"
        case .shareRevoked: "shareRevoked"
        case .ghostEnabled: "ghostEnabled"
        case .presenceCleared: "presenceCleared"
        case .presenceExpired: "presenceExpired"
        case .sceneBackgrounded: "sceneBackgrounded"
        }
    }
}

@MainActor
private func XCTAssertThrowsAuthError<T>(
    _ expression: () async throws -> T,
    verify: (Error) -> Void,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail("Expected error", file: file, line: line)
    } catch {
        verify(error)
    }
}
