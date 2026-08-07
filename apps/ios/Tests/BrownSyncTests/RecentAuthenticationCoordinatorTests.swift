import Foundation
import XCTest

@testable import BrownSync

@MainActor
final class RecentAuthenticationCoordinatorTests: XCTestCase {
    func testTransientAccessTokenRedactsAndClearsSecret() async {
        let token = TransientAccessToken("secret-access-token")

        for rendered in [
            String(describing: token),
            String(reflecting: token),
        ] {
            XCTAssertFalse(rendered.contains("secret-access-token"))
        }

        token.clear()
        await XCTAssertThrowsDeletionError {
            try await token.accessToken()
        } verify: { error in
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
    }

    func testTransientAuthStorageClearsWithoutExposingSessionBytes()
        throws
    {
        let storage = TransientAuthLocalStorage()
        let secret = Data("secret-session".utf8)

        try storage.store(key: "session", value: secret)
        XCTAssertEqual(try storage.retrieve(key: "session"), secret)
        for rendered in [
            String(describing: storage),
            String(reflecting: storage),
        ] {
            XCTAssertFalse(rendered.contains("secret-session"))
        }

        storage.clear()
        XCTAssertNil(try storage.retrieve(key: "session"))
    }

    func testProductionContextFactoryUsesAndClearsOnlyMemoryStorage()
        async throws
    {
        let storage = TransientAuthLocalStorage()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [IsolatedReauthURLProtocol.self]
        let urlSession = URLSession(configuration: configuration)
        IsolatedReauthURLProtocol.reset()
        let factory = SupabaseRecentAuthenticationContextFactory(
            supabaseURL: URL(string: "https://project.supabase.co")!,
            supabasePublishableKey: "sb_publishable_test",
            apiBaseURL: URL(
                string: "https://api.brownsync.invalid"
            )!,
            urlSession: urlSession,
            storageFactory: { storage }
        )

        let context = try await factory.makeContext(
            googleIdentity: GoogleIdentityTokenPair(
                idToken: "fresh-id",
                accessToken: "fresh-access",
                hostedDomain: "brown.edu"
            )
        )

        XCTAssertNil(
            try storage.retrieve(key: "supabase.auth.token")
        )
        let identity = try await context.currentIdentity()
        XCTAssertEqual(
            identity,
            deletionIdentity(id: deletionExpectedUserID())
        )
        try await context.deleteAccount()
        await context.clear()
        XCTAssertEqual(
            IsolatedReauthURLProtocol.recordedRequests(),
            [
                "POST project.supabase.co/auth/v1/token "
                    + "Bearer sb_publishable_test",
                "GET api.brownsync.invalid/api/me "
                    + "Bearer isolated-worker-token",
                "DELETE api.brownsync.invalid/api/account "
                    + "Bearer isolated-worker-token",
            ]
        )
    }

    func testDeletionUsesIsolatedContextBeforeCanonicalCleanup() async throws {
        let expectedUserID = deletionExpectedUserID()
        let log = DeletionCallLog()
        let context = DeletionContextFake(
            identity: deletionIdentity(id: expectedUserID),
            deletionResult: .success(()),
            log: log
        )
        let coordinator = makeDeletionCoordinator(
            log: log,
            context: context
        )

        try await coordinator.deleteAccount(expectedUserID: expectedUserID)

        let entries = await log.values()
        XCTAssertEqual(
            entries,
            [
                "google.interactive",
                "context.create",
                "context.me",
                "context.delete",
                "context.clear",
                "invalidate.accountDeleted",
                "canonical.signout",
                "google.signout",
            ]
        )
    }

    func testCancellationAfterNoContentStillCompletesCanonicalCleanup()
        async throws
    {
        let expectedUserID = deletionExpectedUserID()
        let log = DeletionCallLog()
        let context = DeletionContextFake(
            identity: deletionIdentity(id: expectedUserID),
            deletionResult: .success(()),
            log: log,
            cancelTaskAfterDelete: true
        )
        let coordinator = makeDeletionCoordinator(
            log: log,
            context: context
        )

        try await coordinator.deleteAccount(expectedUserID: expectedUserID)

        let entries = await log.values()
        XCTAssertEqual(
            entries,
            [
                "google.interactive",
                "context.create",
                "context.me",
                "context.delete",
                "context.clear",
                "invalidate.accountDeleted",
                "canonical.signout",
                "google.signout",
            ]
        )
    }

    func testRecentAuthenticationFailureClearsOnlyIsolatedContext() async {
        let expectedUserID = deletionExpectedUserID()
        let log = DeletionCallLog()
        let context = DeletionContextFake(
            identity: deletionIdentity(id: expectedUserID),
            deletionResult: .failure(APIError.recentAuthenticationRequired),
            log: log
        )
        let coordinator = makeDeletionCoordinator(
            log: log,
            context: context
        )

        await XCTAssertThrowsDeletionError {
            try await coordinator.deleteAccount(
                expectedUserID: expectedUserID
            )
        } verify: { error in
            XCTAssertEqual(error as? APIError, .recentAuthenticationRequired)
        }

        let entries = await log.values()
        XCTAssertEqual(
            entries,
            [
                "google.interactive",
                "context.create",
                "context.me",
                "context.delete",
                "context.clear",
            ]
        )
    }

    func testFailureBeforeNoContentClearsOnlyIsolatedContext() async {
        let expectedUserID = deletionExpectedUserID()
        let log = DeletionCallLog()
        let context = DeletionContextFake(
            identity: deletionIdentity(id: expectedUserID),
            deletionResult: .failure(DeletionTestError.failed),
            log: log
        )
        let coordinator = makeDeletionCoordinator(
            log: log,
            context: context
        )

        await XCTAssertThrowsDeletionError {
            try await coordinator.deleteAccount(
                expectedUserID: expectedUserID
            )
        } verify: { _ in }

        let entries = await log.values()
        XCTAssertEqual(
            entries,
            [
                "google.interactive",
                "context.create",
                "context.me",
                "context.delete",
                "context.clear",
            ]
        )
    }

    func testDifferentBrownIdentityNeverTouchesCanonicalSession() async {
        let expectedUserID = deletionExpectedUserID()
        let log = DeletionCallLog()
        let context = DeletionContextFake(
            identity: deletionIdentity(
                id: UUID(
                    uuidString: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
                )!
            ),
            deletionResult: .success(()),
            log: log
        )
        let coordinator = makeDeletionCoordinator(
            log: log,
            context: context
        )

        await XCTAssertThrowsDeletionError {
            try await coordinator.deleteAccount(
                expectedUserID: expectedUserID
            )
        } verify: { error in
            XCTAssertEqual(
                error as? RecentAuthenticationError,
                .identityMismatch
            )
        }

        let entries = await log.values()
        XCTAssertEqual(
            entries,
            [
                "google.interactive",
                "context.create",
                "context.me",
                "context.clear",
            ]
        )
    }

    func testCancellationWhileCheckingIdentityNeverReachesDelete() async {
        let expectedUserID = deletionExpectedUserID()
        let log = DeletionCallLog()
        let context = DeletionContextFake(
            identity: deletionIdentity(id: expectedUserID),
            deletionResult: .success(()),
            log: log,
            suspendCurrentIdentity: true
        )
        let coordinator = makeDeletionCoordinator(
            log: log,
            context: context
        )
        let deletion = Task {
            try await coordinator.deleteAccount(
                expectedUserID: expectedUserID
            )
        }

        await context.waitForCurrentIdentitySuspension()
        deletion.cancel()
        await context.resumeCurrentIdentity()

        await XCTAssertThrowsDeletionError {
            try await deletion.value
        } verify: { error in
            XCTAssertTrue(error is CancellationError)
        }
        let entries = await log.values()
        XCTAssertEqual(
            entries,
            [
                "google.interactive",
                "context.create",
                "context.me",
                "context.clear",
            ]
        )
    }

    func testCancellationAsContextReturnsStillClearsContext() async {
        let log = DeletionCallLog()
        let context = DeletionContextFake(
            identity: deletionIdentity(id: deletionExpectedUserID()),
            deletionResult: .success(()),
            log: log
        )
        let creator = DeletionContextCreatorFake(
            context: context,
            error: nil,
            log: log,
            suspendCreation: true
        )
        let coordinator = RecentAuthenticationCoordinator(
            googleIdentity: DeletionGoogleFake(log: log),
            canonicalSession: DeletionCanonicalSessionFake(
                token: "canonical-original-token",
                log: log
            ),
            contextCreator: creator,
            invalidator: DeletionInvalidatorFake(log: log)
        )
        let deletion = Task {
            try await coordinator.deleteAccount(
                expectedUserID: deletionExpectedUserID()
            )
        }

        await creator.waitForCreationSuspension()
        deletion.cancel()
        await creator.resumeCreation()

        await XCTAssertThrowsDeletionError {
            try await deletion.value
        } verify: { error in
            XCTAssertTrue(error is CancellationError)
        }
        let entries = await log.values()
        XCTAssertEqual(
            entries,
            [
                "google.interactive",
                "context.create",
                "context.clear",
            ]
        )
    }

    func testConcurrentCanonicalRequestKeepsOriginalSessionDuringReauth()
        async throws
    {
        let expectedUserID = deletionExpectedUserID()
        let log = DeletionCallLog()
        let canonicalSession = DeletionCanonicalSessionFake(
            token: "canonical-original-token",
            log: log
        )
        let context = DeletionContextFake(
            identity: deletionIdentity(id: expectedUserID),
            deletionResult: .success(()),
            log: log,
            suspendCurrentIdentity: true
        )
        let coordinator = makeDeletionCoordinator(
            log: log,
            canonicalSession: canonicalSession,
            context: context
        )
        let deletion = Task {
            try await coordinator.deleteAccount(
                expectedUserID: expectedUserID
            )
        }

        await context.waitForCurrentIdentitySuspension()
        let concurrentToken = try await BearerTokenProvider(
            session: canonicalSession
        ).accessToken()

        XCTAssertEqual(concurrentToken, "canonical-original-token")

        deletion.cancel()
        await context.resumeCurrentIdentity()
        await XCTAssertThrowsDeletionError {
            try await deletion.value
        } verify: { error in
            XCTAssertTrue(error is CancellationError)
        }
        let entries = await log.values()
        XCTAssertEqual(
            entries,
            [
                "google.interactive",
                "context.create",
                "context.me",
                "context.clear",
            ]
        )
    }

    func testContextCreationFailureLeavesCanonicalSessionUntouched() async {
        let log = DeletionCallLog()
        let coordinator = RecentAuthenticationCoordinator(
            googleIdentity: DeletionGoogleFake(log: log),
            canonicalSession: DeletionCanonicalSessionFake(
                token: "canonical-original-token",
                log: log
            ),
            contextCreator: DeletionContextCreatorFake(
                context: nil,
                error: DeletionTestError.failed,
                log: log
            ),
            invalidator: DeletionInvalidatorFake(log: log)
        )

        await XCTAssertThrowsDeletionError {
            try await coordinator.deleteAccount(
                expectedUserID: deletionExpectedUserID()
            )
        } verify: { _ in }

        let entries = await log.values()
        XCTAssertEqual(
            entries,
            [
                "google.interactive",
                "context.create",
            ]
        )
    }

    private func makeDeletionCoordinator(
        log: DeletionCallLog,
        canonicalSession: DeletionCanonicalSessionFake? = nil,
        context: DeletionContextFake
    ) -> RecentAuthenticationCoordinator {
        RecentAuthenticationCoordinator(
            googleIdentity: DeletionGoogleFake(log: log),
            canonicalSession: canonicalSession
                ?? DeletionCanonicalSessionFake(token: "token", log: log),
            contextCreator: DeletionContextCreatorFake(
                context: context,
                error: nil,
                log: log
            ),
            invalidator: DeletionInvalidatorFake(log: log)
        )
    }
}

private func deletionExpectedUserID() -> UUID {
    UUID(uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")!
}

private func deletionIdentity(id: UUID) -> AdmittedIdentity {
    AdmittedIdentity(id: id, email: "student@brown.edu")
}

private enum DeletionTestError: Error {
    case failed
}

private actor DeletionCallLog {
    private var entries: [String] = []
    func append(_ entry: String) { entries.append(entry) }
    func values() -> [String] { entries }
}

private final class DeletionGoogleFake:
    GoogleIdentityProviding,
    @unchecked Sendable
{
    private let log: DeletionCallLog

    init(log: DeletionCallLog) {
        self.log = log
    }

    func configure() async throws {}

    func interactiveTokenPair() async throws -> GoogleIdentityTokenPair {
        await log.append("google.interactive")
        return GoogleIdentityTokenPair(
            idToken: "fresh-id",
            accessToken: "fresh-access",
            hostedDomain: "brown.edu"
        )
    }

    func restoreTokenPair() async throws -> GoogleIdentityTokenPair? { nil }
    func handle(_ url: URL) -> Bool { false }
    func signOut() async { await log.append("google.signout") }
}

private actor DeletionCanonicalSessionFake: SessionProviding {
    private var token: String
    private let log: DeletionCallLog

    init(token: String, log: DeletionCallLog) {
        self.token = token
        self.log = log
    }

    func exchangeGoogleIdentity(
        _ pair: GoogleIdentityTokenPair
    ) async throws {
        await log.append("canonical.exchange")
    }

    func validAccessToken() async throws -> String {
        token
    }

    func refreshSession() async throws {
        await log.append("canonical.refresh")
    }

    func signOutLocal() async throws {
        token = ""
        await log.append("canonical.signout")
    }

    func authEvents() -> AsyncStream<AuthSessionEvent> {
        AsyncStream { $0.finish() }
    }
}

private actor DeletionContextCreatorFake:
    RecentAuthenticationContextCreating
{
    private let context: (any RecentAuthenticationContext)?
    private let error: Error?
    private let log: DeletionCallLog
    private let suspendCreation: Bool
    private var creationContinuation: CheckedContinuation<Void, Never>?

    init(
        context: (any RecentAuthenticationContext)?,
        error: Error?,
        log: DeletionCallLog,
        suspendCreation: Bool = false
    ) {
        self.context = context
        self.error = error
        self.log = log
        self.suspendCreation = suspendCreation
    }

    func makeContext(
        googleIdentity pair: GoogleIdentityTokenPair
    ) async throws -> any RecentAuthenticationContext {
        await log.append("context.create")
        if suspendCreation {
            await withCheckedContinuation { continuation in
                creationContinuation = continuation
            }
        }
        if let error {
            throw error
        }
        return context!
    }

    func waitForCreationSuspension() async {
        while creationContinuation == nil {
            await Task.yield()
        }
    }

    func resumeCreation() {
        creationContinuation?.resume()
        creationContinuation = nil
    }
}

private actor DeletionContextFake: RecentAuthenticationContext {
    private let identity: AdmittedIdentity
    private let deletionResult: Result<Void, Error>
    private let log: DeletionCallLog
    private let suspendCurrentIdentity: Bool
    private let cancelTaskAfterDelete: Bool
    private var currentIdentityContinuation:
        CheckedContinuation<Void, Never>?
    private var isCleared = false

    init(
        identity: AdmittedIdentity,
        deletionResult: Result<Void, Error>,
        log: DeletionCallLog,
        suspendCurrentIdentity: Bool = false,
        cancelTaskAfterDelete: Bool = false
    ) {
        self.identity = identity
        self.deletionResult = deletionResult
        self.log = log
        self.suspendCurrentIdentity = suspendCurrentIdentity
        self.cancelTaskAfterDelete = cancelTaskAfterDelete
    }

    func currentIdentity() async throws -> AdmittedIdentity {
        await log.append("context.me")
        if suspendCurrentIdentity {
            await withCheckedContinuation { continuation in
                currentIdentityContinuation = continuation
            }
        }
        return identity
    }

    func deleteAccount() async throws {
        await log.append("context.delete")
        try deletionResult.get()
        if cancelTaskAfterDelete {
            withUnsafeCurrentTask { task in
                task?.cancel()
            }
        }
    }

    func clear() async {
        guard !isCleared else { return }
        isCleared = true
        await log.append("context.clear")
    }

    func waitForCurrentIdentitySuspension() async {
        while currentIdentityContinuation == nil {
            await Task.yield()
        }
    }

    func resumeCurrentIdentity() {
        currentIdentityContinuation?.resume()
        currentIdentityContinuation = nil
    }
}

private actor DeletionInvalidatorFake: ProtectedSessionInvalidating {
    private let log: DeletionCallLog

    init(log: DeletionCallLog) {
        self.log = log
    }

    func invalidate(reason: SensitiveCachePurgeReason) async {
        switch reason {
        case .accountDeleted:
            await log.append("invalidate.accountDeleted")
        case .authExpired:
            await log.append("invalidate.authExpired")
        default:
            await log.append("invalidate.other")
        }
    }
}

private final class IsolatedReauthRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var entries: [String] = []

    func reset() {
        lock.lock()
        entries.removeAll()
        lock.unlock()
    }

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

private final class IsolatedReauthURLProtocol: URLProtocol {
    private static let recorder = IsolatedReauthRequestRecorder()

    static func reset() {
        recorder.reset()
    }

    static func recordedRequests() -> [String] {
        recorder.values()
    }

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(
        for request: URLRequest
    ) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let url = request.url else {
            client?.urlProtocol(
                self,
                didFailWithError: URLError(.badURL)
            )
            return
        }
        let authorization = request.value(
            forHTTPHeaderField: "Authorization"
        ) ?? ""
        Self.recorder.append(
            "\(request.httpMethod ?? "") \(url.host ?? "")\(url.path) "
                + authorization
        )

        let response: HTTPURLResponse
        let data: Data
        switch (url.host, url.path, request.httpMethod) {
        case ("project.supabase.co", "/auth/v1/token", "POST"):
            response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            data = Data(Self.sessionJSON.utf8)
        case ("api.brownsync.invalid", "/api/me", "GET"):
            response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            data = Data(
                """
                {
                  "id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                  "email":"student@brown.edu"
                }
                """.utf8
            )
        case ("api.brownsync.invalid", "/api/account", "DELETE"):
            response = HTTPURLResponse(
                url: url,
                statusCode: 204,
                httpVersion: nil,
                headerFields: nil
            )!
            data = Data()
        default:
            response = HTTPURLResponse(
                url: url,
                statusCode: 404,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            data = Data(#"{"error":"unexpected request"}"#.utf8)
        }

        client?.urlProtocol(
            self,
            didReceive: response,
            cacheStoragePolicy: .notAllowed
        )
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static let sessionJSON = """
        {
          "access_token":"isolated-worker-token",
          "token_type":"bearer",
          "expires_in":3600,
          "expires_at":2000000000,
          "refresh_token":"memory-only-refresh",
          "user":{
            "id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "aud":"authenticated",
            "app_metadata":{},
            "user_metadata":{},
            "created_at":"2026-07-30T00:00:00Z",
            "updated_at":"2026-07-30T00:00:00Z"
          }
        }
        """
}

@MainActor
private func XCTAssertThrowsDeletionError<T>(
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
