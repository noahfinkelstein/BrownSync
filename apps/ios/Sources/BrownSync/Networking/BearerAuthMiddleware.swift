import Foundation
import HTTPTypes
import OpenAPIRuntime

protocol AccessTokenProviding: Sendable {
    func accessToken() async throws -> String
}

final class TransientAccessToken:
    AccessTokenProviding,
    @unchecked Sendable,
    CustomStringConvertible,
    CustomDebugStringConvertible,
    CustomReflectable
{
    private let lock = NSLock()
    private var token: String?

    init(_ token: String) {
        self.token = token
    }

    func accessToken() async throws -> String {
        try currentToken()
    }

    func clear() {
        lock.lock()
        token = nil
        lock.unlock()
    }

    deinit {
        clear()
    }

    var description: String {
        "<redacted transient access token>"
    }

    var debugDescription: String {
        description
    }

    var customMirror: Mirror {
        Mirror(self, children: ["value": description])
    }

    private func currentToken() throws -> String {
        lock.lock()
        defer { lock.unlock() }
        guard let token else {
            throw APIError.unauthorized
        }
        return token
    }
}

struct BearerTokenProvider: AccessTokenProviding {
    private let session: any SessionProviding

    init(session: any SessionProviding) {
        self.session = session
    }

    func accessToken() async throws -> String {
        try await session.validAccessToken()
    }
}

struct BearerAuthMiddleware: ClientMiddleware {
    private let tokenProvider: any AccessTokenProviding

    init(tokenProvider: any AccessTokenProviding) {
        self.tokenProvider = tokenProvider
    }

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (
            HTTPRequest,
            HTTPBody?,
            URL
        ) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var authorizedRequest = request
        let token = try await tokenProvider.accessToken()
        authorizedRequest.headerFields[.authorization] = "Bearer \(token)"
        return try await next(authorizedRequest, body, baseURL)
    }
}
