import BrownSyncAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import XCTest

@testable import BrownSync

final class WorkerAPIClientTests: XCTestCase {
    func testWorkerDateTranscoderAcceptsWholeAndFractionalSeconds()
        throws
    {
        let transcoder = WorkerAPIDateTranscoder()
        let wholeSeconds = try transcoder.decode(
            "2026-07-30T00:01:00Z"
        )
        let fractionalSeconds = try transcoder.decode(
            "2026-07-30T00:01:00.123Z"
        )

        XCTAssertEqual(
            fractionalSeconds.timeIntervalSince(wholeSeconds),
            0.123,
            accuracy: 0.001
        )
        XCTAssertEqual(
            try transcoder.encode(fractionalSeconds),
            "2026-07-30T00:01:00.123Z"
        )
    }

    func testPublicGeneratedClientNeverRequestsABearerToken() async throws {
        let tokenProvider = CountingAccessTokenProvider()
        let clients = WorkerAPIClients(
            baseURL: URL(string: "https://api.brownsync.invalid")!,
            tokenProvider: tokenProvider,
            transport: PublicHealthTransport()
        )

        _ = try await clients.publicClient.getApiHealth()

        let requestCount = await tokenProvider.requestCount()
        XCTAssertEqual(requestCount, 0)
    }

    func testGeneratedProtectedGetRefreshesAndRetriesOnceAfterUnauthorized()
        async throws
    {
        let session = RetryingSessionFake()
        let transport = RetryingMeTransport()
        let clients = WorkerAPIClients(
            baseURL: URL(string: "https://api.brownsync.invalid")!,
            tokenProvider: BearerTokenProvider(session: session),
            transport: transport
        )
        let repository = WorkerAccountRepository(
            client: clients.protectedClient,
            retrier: WorkerRequestRetrier(session: session)
        )

        let identity = try await repository.currentIdentity()

        XCTAssertEqual(
            identity,
            AdmittedIdentity(
                id: UUID(uuidString: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")!,
                email: "student@brown.edu"
            )
        )
        let refreshCount = await session.refreshCount()
        let requestCount = await transport.requestCount()
        XCTAssertEqual(refreshCount, 1)
        XCTAssertEqual(requestCount, 2)
    }

    func testCancelledAccountDeletionNeverSendsMutation() async {
        let gate = CancellationGate()
        let transport = CountingDeleteTransport()
        let session = RetryingSessionFake()
        let clients = WorkerAPIClients(
            baseURL: URL(string: "https://api.brownsync.invalid")!,
            tokenProvider: BearerTokenProvider(session: session),
            transport: transport
        )
        let repository = WorkerAccountRepository(
            client: clients.protectedClient,
            retrier: WorkerRequestRetrier(session: session)
        )
        let deletion = Task {
            await gate.suspend()
            try await repository.deleteAccount()
        }

        await gate.waitUntilSuspended()
        deletion.cancel()
        await gate.resume()

        do {
            try await deletion.value
            XCTFail("Expected cancellation")
        } catch {
            XCTAssertTrue(error is CancellationError)
        }
        let requestCount = await transport.requestCount()
        XCTAssertEqual(requestCount, 0)
    }

    func testExplicitNoRetryRetrierMakesOneSafeReadAttempt() async {
        let attempts = WorkerAttemptCounter()
        let retrier = WorkerRequestRetrier.withoutAuthenticationRetry

        do {
            let _: String = try await retrier.run(method: .get) {
                _ = await attempts.increment()
                throw APIError.unauthorized
            }
            XCTFail("Expected unauthorized")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }

        let attemptCount = await attempts.value()
        XCTAssertEqual(attemptCount, 1)
    }
}

private actor WorkerAttemptCounter {
    private var count = 0

    func increment() -> Int {
        count += 1
        return count
    }

    func value() -> Int {
        count
    }
}

private actor CancellationGate {
    private var continuation: CheckedContinuation<Void, Never>?

    func suspend() async {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func waitUntilSuspended() async {
        while continuation == nil {
            await Task.yield()
        }
    }

    func resume() {
        continuation?.resume()
        continuation = nil
    }
}

private actor CountingAccessTokenProvider: AccessTokenProviding {
    private var count = 0
    func accessToken() async throws -> String {
        count += 1
        return "token"
    }
    func requestCount() -> Int { count }
}

private struct PublicHealthTransport: ClientTransport {
    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var headerFields = HTTPFields()
        headerFields[.contentType] = "application/json"
        return (
            HTTPResponse(status: .ok, headerFields: headerFields),
            HTTPBody(#"{"sources":[]}"#)
        )
    }
}

private actor CountingDeleteTransport: ClientTransport {
    private var requests = 0

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        requests += 1
        return (HTTPResponse(status: .noContent), nil)
    }

    func requestCount() -> Int {
        requests
    }
}

private actor RetryingSessionFake: SessionProviding {
    private var refreshes = 0

    func exchangeGoogleIdentity(_ pair: GoogleIdentityTokenPair) async throws {}
    func validAccessToken() async throws -> String { "token" }
    func refreshSession() async throws { refreshes += 1 }
    func signOutLocal() async throws {}
    func authEvents() -> AsyncStream<AuthSessionEvent> {
        AsyncStream { $0.finish() }
    }
    func refreshCount() -> Int { refreshes }
}

private actor RetryingMeTransport: ClientTransport {
    private var requests = 0

    func send(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String
    ) async throws -> (HTTPResponse, HTTPBody?) {
        requests += 1
        var headerFields = HTTPFields()
        headerFields[.contentType] = "application/json"
        if requests == 1 {
            return (
                HTTPResponse(
                    status: .unauthorized,
                    headerFields: headerFields
                ),
                HTTPBody(
                    #"{"error":{"code":"unauthorized","message":"expired"}}"#
                )
            )
        }
        return (
            HTTPResponse(status: .ok, headerFields: headerFields),
            HTTPBody(
                #"{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","email":"student@brown.edu"}"#
            )
        )
    }

    func requestCount() -> Int { requests }
}
