import BrownSyncAPI
import Foundation
import OpenAPIRuntime
import OpenAPIURLSession

struct WorkerAPIDateTranscoder: DateTranscoder {
    private let fractional = ISO8601DateTranscoder
        .iso8601WithFractionalSeconds
    private let wholeSeconds = ISO8601DateTranscoder.iso8601

    func encode(_ date: Date) throws -> String {
        try fractional.encode(date)
    }

    func decode(_ dateString: String) throws -> Date {
        do {
            return try fractional.decode(dateString)
        } catch {
            return try wholeSeconds.decode(dateString)
        }
    }
}

enum WorkerAPIClientDefaults {
    static var configuration: OpenAPIRuntime.Configuration {
        .init(dateTranscoder: WorkerAPIDateTranscoder())
    }
}

enum WorkerHTTPMethod: Sendable {
    case get
    case head
    case mutation

    var permitsAuthenticationRetry: Bool {
        switch self {
        case .get, .head:
            return true
        case .mutation:
            return false
        }
    }
}

struct WorkerRequestRetrier: Sendable {
    private let session: (any SessionProviding)?

    init(session: any SessionProviding) {
        self.session = session
    }

    private init() {
        session = nil
    }

    static var withoutAuthenticationRetry: WorkerRequestRetrier {
        WorkerRequestRetrier()
    }

    func run<Value: Sendable>(
        method: WorkerHTTPMethod,
        operation: @Sendable () async throws -> Value
    ) async throws -> Value {
        do {
            return try await operation()
        } catch APIError.unauthorized {
            guard
                method.permitsAuthenticationRetry,
                let session
            else {
                throw APIError.unauthorized
            }
            do {
                try await session.refreshSession()
            } catch {
                try Task.checkCancellation()
                throw APIError.unauthorized
            }
            return try await operation()
        }
    }
}

struct WorkerAPIClients: Sendable {
    let publicClient: BrownSyncAPI.Client
    let protectedClient: BrownSyncAPI.Client

    init(
        baseURL: URL,
        tokenProvider: any AccessTokenProviding,
        urlSession: URLSession = .shared
    ) {
        self.init(
            baseURL: baseURL,
            tokenProvider: tokenProvider,
            transport: URLSessionTransport(
                configuration: .init(session: urlSession)
            )
        )
    }

    init(
        baseURL: URL,
        tokenProvider: any AccessTokenProviding,
        transport: any ClientTransport
    ) {
        publicClient = BrownSyncAPI.Client(
            serverURL: baseURL,
            configuration: WorkerAPIClientDefaults.configuration,
            transport: transport
        )
        protectedClient = BrownSyncAPI.Client(
            serverURL: baseURL,
            configuration: WorkerAPIClientDefaults.configuration,
            transport: transport,
            middlewares: [
                BearerAuthMiddleware(tokenProvider: tokenProvider)
            ]
        )
    }
}

actor WorkerAccountRepository: AccountRepository {
    private let client: BrownSyncAPI.Client
    private let retrier: WorkerRequestRetrier

    init(
        client: BrownSyncAPI.Client,
        retrier: WorkerRequestRetrier
    ) {
        self.client = client
        self.retrier = retrier
    }

    func currentIdentity() async throws -> AdmittedIdentity {
        try await retrier.run(method: .get) { [client] in
            let output = try await client.getApiMe()
            switch output {
            case let .ok(response):
                switch response.body {
                case let .json(me):
                    guard let id = UUID(uuidString: me.id) else {
                        throw APIError.invalidResponse
                    }
                    return AdmittedIdentity(id: id, email: me.email)
                }
            case .unauthorized:
                throw APIError.unauthorized
            case let .forbidden(response):
                switch response.body {
                case let .json(envelope):
                    throw APIError.normalized(
                        status: 403,
                        code: envelope.error.code
                    )
                }
            case .serviceUnavailable:
                throw APIError.unavailable
            case let .undocumented(statusCode, _):
                throw APIError.server(status: statusCode, code: nil)
            }
        }
    }

    func deleteAccount() async throws {
        try Task.checkCancellation()
        let output = try await retrier.run(method: .mutation) { [client] in
            try await client.deleteApiAccount()
        }
        switch output {
        case .noContent:
            return
        case .unauthorized:
            throw APIError.unauthorized
        case let .forbidden(response):
            switch response.body {
            case let .json(envelope):
                throw APIError.normalized(
                    status: 403,
                    code: envelope.error.code
                )
            }
        case .tooManyRequests:
            throw APIError.rateLimited
        case .serviceUnavailable:
            throw APIError.unavailable
        case let .undocumented(statusCode, _):
            throw APIError.server(status: statusCode, code: nil)
        }
    }
}
